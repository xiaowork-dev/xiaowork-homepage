package mediautils

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

func sourcePNG(t *testing.T) []byte {
	t.Helper()
	m := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	m.SetNRGBA(0, 0, color.NRGBA{R: 30, G: 80, B: 150, A: 100})
	var b bytes.Buffer
	if err := png.Encode(&b, m); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func pngChunk(name string, data []byte) []byte {
	b := make([]byte, len(data)+12)
	binary.BigEndian.PutUint32(b, uint32(len(data)))
	copy(b[4:8], name)
	copy(b[8:], data)
	binary.BigEndian.PutUint32(b[len(b)-4:], crc32.ChecksumIEEE(b[4:len(b)-4]))
	return b
}

func TestSanitizeReencodesAndStripsMetadata(t *testing.T) {
	plain := sourcePNG(t)
	metadata := []byte("Comment\x00private-GPS-test-marker")
	withText := append(append(append([]byte{}, plain[:33]...), pngChunk("tEXt", metadata)...), plain[33:]...)
	got, err := Sanitize(bytes.NewReader(withText), "screen.png", "image/png")
	if err != nil {
		t.Fatal(err)
	}
	if got.Width != 2 || got.Height != 2 || got.MediaType != "image/png" || len(got.SHA256) != 64 || bytes.Contains(got.Bytes, metadata) {
		t.Fatalf("unsafe or incorrect PNG result: %+v", got)
	}
	decoded, err := png.Decode(bytes.NewReader(got.Bytes))
	if err != nil {
		t.Fatal(err)
	}
	if color.NRGBAModel.Convert(decoded.At(0, 0)) != (color.NRGBA{R: 30, G: 80, B: 150, A: 100}) {
		t.Fatal("PNG transparency/colors changed")
	}
	var jpegBytes bytes.Buffer
	if err := jpeg.Encode(&jpegBytes, image.NewRGBA(image.Rect(0, 0, 2, 2)), nil); err != nil {
		t.Fatal(err)
	}
	comment := []byte("private-EXIF-GPS-test-marker")
	segment := append([]byte{0xff, 0xfe, byte((len(comment) + 2) >> 8), byte(len(comment) + 2)}, comment...)
	withComment := append(append(append([]byte{}, jpegBytes.Bytes()[:2]...), segment...), jpegBytes.Bytes()[2:]...)
	got, err = Sanitize(bytes.NewReader(withComment), "screen.jpeg", "image/jpeg")
	if err != nil || got.MediaType != "image/jpeg" || got.Extension != ".jpg" || bytes.Contains(got.Bytes, comment) {
		t.Fatalf("JPEG was not sanitized: %v", err)
	}
}

func TestSanitizeRealWebPAndRejectsConcealedLargeFrame(t *testing.T) {
	// Generated locally from a new uniform 2x2 RGBA image, not a project screenshot.
	webp, err := base64.StdEncoding.DecodeString("UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAEAdQqHrUsmSBiOh/AAA=")
	if err != nil {
		t.Fatal(err)
	}
	got, err := Sanitize(bytes.NewReader(webp), "alpha.webp", "image/webp")
	if err != nil || got.Width != 2 || got.Height != 2 || got.MediaType != "image/png" {
		t.Fatalf("valid WebP failed: %+v %v", got, err)
	}
	decoded, err := png.Decode(bytes.NewReader(got.Bytes))
	if err != nil || color.NRGBAModel.Convert(decoded.At(0, 0)) != (color.NRGBA{R: 30, G: 80, B: 150, A: 100}) {
		t.Fatal("WebP transparency/colors changed")
	}
	canvas := make([]byte, 10)
	canvas[4], canvas[7] = 1, 1
	frame := []byte{0x2f, 0xff, 0xff, 0xff, 0x0f}
	chunk := func(name string, data []byte) []byte {
		b := make([]byte, 8+len(data)+len(data)%2)
		copy(b, name)
		binary.LittleEndian.PutUint32(b[4:8], uint32(len(data)))
		copy(b[8:], data)
		return b
	}
	body := append(chunk("VP8X", canvas), chunk("VP8L", frame)...)
	malicious := append([]byte("RIFF\x00\x00\x00\x00WEBP"), body...)
	binary.LittleEndian.PutUint32(malicious[4:8], uint32(len(malicious)-8))
	if _, err := Sanitize(bytes.NewReader(malicious), "bomb.webp", "image/webp"); !errors.Is(err, ErrTooLarge) {
		t.Fatalf("concealed large WebP frame accepted: %v", err)
	}
	canvas[0] = 2
	body = chunk("VP8X", canvas)
	animated := append([]byte("RIFF\x00\x00\x00\x00WEBP"), body...)
	binary.LittleEndian.PutUint32(animated[4:8], uint32(len(animated)-8))
	if _, err := Sanitize(bytes.NewReader(animated), "animation.webp", "image/webp"); !errors.Is(err, ErrUnsupported) {
		t.Fatalf("animation not rejected: %v", err)
	}
}

func TestSanitizeRejectsFormatSpoofingAndLimitsBeforeDecode(t *testing.T) {
	plain := sourcePNG(t)
	for _, tc := range []struct {
		name, mime string
		bytes      []byte
		want       error
	}{
		{"fake.jpg", "image/jpeg", plain, ErrUnsupported},
		{"fake.png", "image/jpeg", plain, ErrUnsupported},
		{"../escape.png", "image/png", plain, ErrUnsupported},
		{"C:\\escape.png", "image/png", plain, ErrUnsupported},
		{"image.svg", "image/svg+xml", []byte("<svg/>"), ErrUnsupported},
		{"bad.png", "image/png", []byte("not an image"), ErrUnsupported},
		{"huge.png", "image/png", make([]byte, MaxOriginalBytes+1), ErrTooLarge},
	} {
		t.Run(tc.name+tc.mime, func(t *testing.T) {
			if _, err := Sanitize(bytes.NewReader(tc.bytes), tc.name, tc.mime); !errors.Is(err, tc.want) {
				t.Fatalf("got %v want %v", err, tc.want)
			}
		})
	}
	for _, dimensions := range [][2]uint32{{8193, 1}, {5001, 5000}, {8192, 8192}} {
		ihdr := make([]byte, 13)
		binary.BigEndian.PutUint32(ihdr[:4], dimensions[0])
		binary.BigEndian.PutUint32(ihdr[4:8], dimensions[1])
		ihdr[8], ihdr[9] = 8, 6
		headerOnly := append(append([]byte{}, plain[:8]...), pngChunk("IHDR", ihdr)...)
		headerOnly = append(headerOnly, pngChunk("IDAT", nil)...)
		if _, err := Sanitize(bytes.NewReader(headerOnly), "bomb.png", "image/png"); !errors.Is(err, ErrTooLarge) {
			t.Fatalf("oversized config %v reached full decode: %v", dimensions, err)
		}
	}
	if !validDimensions(8192, 1) || !validDimensions(5000, 5000) || validDimensions(5001, 5000) {
		t.Fatal("dimension limits incorrect")
	}
	var b bytes.Buffer
	w := &limitedWriter{w: &b, remaining: 2}
	if _, err := w.Write([]byte("abc")); !errors.Is(err, ErrTooLarge) || b.Len() != 0 {
		t.Fatal("derived output cap failed")
	}
}
