// Package mediautils validates and re-encodes untrusted images before storage.
package mediautils

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"image"
	"image/jpeg"
	"image/png"
	"io"
	"mime"
	"path/filepath"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/xiaowork-dev/xiaowork-homepage/backend/internal/contentlimits"

	_ "golang.org/x/image/webp"
)

const (
	MaxOriginalBytes  = contentlimits.MaxOriginalImageBytes
	MaxMultipartBytes = contentlimits.MaxMultipartBytes
	MaxDerivedBytes   = contentlimits.MaxPublishedFileBytes
	MaxDimension      = contentlimits.MaxImageDimension
	MaxPixels         = contentlimits.MaxImagePixels
)

var (
	ErrUnsupported = errors.New("unsupported image format")
	ErrInvalid     = errors.New("invalid image")
	ErrTooLarge    = errors.New("image exceeds resource limits")
)

type Image struct {
	Bytes     []byte
	SHA256    string
	MediaType string
	Extension string
	Width     int
	Height    int
}

// Sanitize never returns input bytes. DecodeConfig is checked before allocating
// decoded pixels, including the actual VP8 frame dimensions in extended WebP.
func Sanitize(src io.ReadSeeker, filename, declaredType string) (Image, error) {
	var result Image
	if !validFilename(filename) {
		return result, ErrUnsupported
	}
	mediaType, params, err := mime.ParseMediaType(declaredType)
	if err != nil || len(params) != 0 {
		return result, ErrUnsupported
	}
	expected := ""
	switch strings.ToLower(filepath.Ext(filename)) {
	case ".png":
		if mediaType == "image/png" {
			expected = "png"
		}
	case ".jpg", ".jpeg":
		if mediaType == "image/jpeg" {
			expected = "jpeg"
		}
	case ".webp":
		if mediaType == "image/webp" {
			expected = "webp"
		}
	}
	if expected == "" {
		return result, ErrUnsupported
	}
	size, err := src.Seek(0, io.SeekEnd)
	if err != nil {
		return result, ErrInvalid
	}
	if size > MaxOriginalBytes {
		return result, ErrTooLarge
	}
	if size < 1 {
		return result, ErrInvalid
	}
	if _, err = src.Seek(0, io.SeekStart); err != nil {
		return result, ErrInvalid
	}
	config, format, err := image.DecodeConfig(src)
	if errors.Is(err, image.ErrFormat) {
		return result, ErrUnsupported
	}
	if err != nil {
		return result, ErrInvalid
	}
	if format != expected {
		return result, ErrUnsupported
	}
	if !validDimensions(config.Width, config.Height) {
		return result, ErrTooLarge
	}
	if format == "webp" {
		if err := validateWebP(src, size, config.Width, config.Height); err != nil {
			return result, err
		}
	}
	if _, err = src.Seek(0, io.SeekStart); err != nil {
		return result, ErrInvalid
	}
	decoded, actual, err := image.Decode(src)
	if err != nil || actual != format {
		return result, ErrInvalid
	}
	bounds := decoded.Bounds()
	if bounds.Dx() != config.Width || bounds.Dy() != config.Height {
		return result, ErrInvalid
	}
	var buffer bytes.Buffer
	limited := &limitedWriter{w: &buffer, remaining: MaxDerivedBytes}
	if format == "jpeg" {
		err = jpeg.Encode(limited, decoded, &jpeg.Options{Quality: 90})
		result.MediaType, result.Extension = "image/jpeg", ".jpg"
	} else {
		// PNG preserves transparency; no external WebP/AVIF encoder is needed.
		err = png.Encode(limited, decoded)
		result.MediaType, result.Extension = "image/png", ".png"
	}
	if err != nil {
		if limited.exceeded || errors.Is(err, ErrTooLarge) {
			return Image{}, ErrTooLarge
		}
		return Image{}, ErrInvalid
	}
	result.Bytes = buffer.Bytes()
	digest := sha256.Sum256(result.Bytes)
	result.SHA256 = hex.EncodeToString(digest[:])
	result.Width, result.Height = config.Width, config.Height
	return result, nil
}

func validFilename(filename string) bool {
	if !utf8.ValidString(filename) || len(filename) > 255 || strings.ContainsAny(filename, "/\\:<>") || strings.TrimSpace(filename) == "" {
		return false
	}
	if strings.TrimSuffix(filename, filepath.Ext(filename)) == "" {
		return false
	}
	for _, r := range filename {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}

func validDimensions(width, height int) bool {
	return width > 0 && height > 0 && width <= MaxDimension && height <= MaxDimension && width <= MaxPixels/height
}

type limitedWriter struct {
	w         io.Writer
	remaining int
	exceeded  bool
}

func (w *limitedWriter) Write(p []byte) (int, error) {
	if len(p) > w.remaining {
		w.exceeded = true
		return 0, ErrTooLarge
	}
	n, err := w.w.Write(p)
	w.remaining -= n
	return n, err
}

// DecodeConfig may use a VP8X canvas before the later VP8/VP8L payload. Validate
// both before decoding so a tiny canvas cannot conceal a much larger frame.
func validateWebP(src io.ReadSeeker, size int64, width, height int) error {
	if _, err := src.Seek(0, io.SeekStart); err != nil {
		return ErrInvalid
	}
	var header [12]byte
	if _, err := io.ReadFull(src, header[:]); err != nil || string(header[:4]) != "RIFF" || string(header[8:]) != "WEBP" || int64(binary.LittleEndian.Uint32(header[4:8]))+8 != size {
		return ErrInvalid
	}
	foundFrame, foundExtended := false, false
	for offset := int64(12); offset < size; {
		if size-offset < 8 {
			return ErrInvalid
		}
		var chunk [8]byte
		if _, err := io.ReadFull(src, chunk[:]); err != nil {
			return ErrInvalid
		}
		length := int64(binary.LittleEndian.Uint32(chunk[4:]))
		padded := length + length%2
		if padded > size-offset-8 {
			return ErrInvalid
		}
		var prefix [10]byte
		read := length
		if read > int64(len(prefix)) {
			read = int64(len(prefix))
		}
		if _, err := io.ReadFull(src, prefix[:read]); err != nil {
			return ErrInvalid
		}
		fw, fh := 0, 0
		switch string(chunk[:4]) {
		case "VP8X":
			if foundExtended || offset != 12 || length != 10 || prefix[0]&0x02 != 0 {
				return ErrUnsupported
			}
			foundExtended = true
			fw = int(prefix[4]) | int(prefix[5])<<8 | int(prefix[6])<<16
			fh = int(prefix[7]) | int(prefix[8])<<8 | int(prefix[9])<<16
			fw++
			fh++
		case "VP8 ":
			if foundFrame || length < 10 || prefix[0]&1 != 0 || string(prefix[3:6]) != "\x9d\x01\x2a" {
				return ErrInvalid
			}
			foundFrame = true
			fw = int(binary.LittleEndian.Uint16(prefix[6:8]) & 0x3fff)
			fh = int(binary.LittleEndian.Uint16(prefix[8:10]) & 0x3fff)
		case "VP8L":
			if foundFrame || length < 5 || prefix[0] != 0x2f || prefix[4]&0xe0 != 0 {
				return ErrInvalid
			}
			foundFrame = true
			fw = 1 + int(prefix[1]) + int(prefix[2]&0x3f)<<8
			fh = 1 + int(prefix[2]>>6) + int(prefix[3])<<2 + int(prefix[4]&0x0f)<<10
		case "ANIM", "ANMF":
			return ErrUnsupported
		}
		if fw != 0 || fh != 0 {
			if !validDimensions(fw, fh) {
				return ErrTooLarge
			}
			if fw != width || fh != height {
				return ErrInvalid
			}
		}
		offset += 8 + padded
		if _, err := src.Seek(offset, io.SeekStart); err != nil {
			return ErrInvalid
		}
	}
	if !foundFrame {
		return ErrInvalid
	}
	return nil
}
