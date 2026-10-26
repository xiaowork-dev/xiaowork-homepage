// Package contentdata owns validated, private workspace content. It never
// publishes files, executes project data, or calls external project URLs.
package contentdata

import (
	"encoding/json"
	"fmt"
	"net"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

const PublicOrigin = "https://xiaoworks.com"

type Error struct {
	Status          int
	Code            string
	Message         string
	CurrentRevision string
}

func (e *Error) Error() string                    { return e.Code }
func (e *Error) HTTPStatus() int                  { return e.Status }
func (e *Error) ErrorCode() string                { return e.Code }
func (e *Error) PublicMessage() string            { return e.Message }
func (e *Error) CurrentWorkspaceRevision() string { return e.CurrentRevision }

func invalid(field string) error {
	return &Error{Status: 422, Code: "VALIDATION_FAILED", Message: "字段不符合内容契约：" + field}
}
func conflict(code, message string) error { return &Error{Status: 409, Code: code, Message: message} }
func NotFound() error                     { return &Error{Status: 404, Code: "NOT_FOUND", Message: "内容不存在。"} }

type Reference struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}
type ProjectInput struct {
	Slug          string    `json:"slug"`
	Name          string    `json:"name"`
	Summary       string    `json:"summary"`
	Description   string    `json:"description"`
	Category      string    `json:"category"`
	TechStack     []string  `json:"techStack"`
	Status        string    `json:"status"`
	Featured      *bool     `json:"featured"`
	Visible       *bool     `json:"visible"`
	IsPlaceholder *bool     `json:"isPlaceholder"`
	Cover         Reference `json:"cover"`
	CoverAlt      string    `json:"coverAlt"`
	CoverKind     string    `json:"coverKind"`
	DemoURL       *string   `json:"demoUrl"`
	RepositoryURL *string   `json:"repositoryUrl"`
}
type Project struct {
	ID string `json:"id"`
	ProjectInput
	Order      int64   `json:"order"`
	CreatedAt  string  `json:"createdAt"`
	UpdatedAt  string  `json:"updatedAt"`
	ArchivedAt *string `json:"archivedAt"`
}
type Category struct {
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	Order        int64  `json:"order"`
	ProjectCount int64  `json:"projectCount"`
}
type SiteProfile struct {
	Name          string   `json:"name"`
	Role          string   `json:"role"`
	Introduction  []string `json:"introduction"`
	Directions    []string `json:"directions"`
	Technologies  []string `json:"technologies"`
	GitHubURL     *string  `json:"githubUrl"`
	AvatarAssetID *string  `json:"avatarAssetId"`
	BrandAssetID  *string  `json:"brandAssetId"`
}
type Capability struct {
	Title        string   `json:"title"`
	Technologies []string `json:"technologies"`
}
type Principle struct {
	Title       string `json:"title"`
	Description string `json:"description"`
}
type Contact struct {
	Label       string `json:"label"`
	Description string `json:"description"`
	URL         string `json:"url"`
}
type Resume struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}
type AboutProfile struct {
	BrandIntroduction    string       `json:"brandIntroduction"`
	PersonalIntroduction []string     `json:"personalIntroduction"`
	Capabilities         []Capability `json:"capabilities"`
	Principles           []Principle  `json:"principles"`
	Contacts             []Contact    `json:"contacts"`
	Resume               *Resume      `json:"resume,omitempty"`
}
type Profile struct {
	Site  SiteProfile  `json:"site"`
	About AboutProfile `json:"about"`
}
type PageSEO struct {
	Title        string  `json:"title"`
	Description  string  `json:"description"`
	ShareAssetID *string `json:"shareAssetId"`
}
type PageSEOSet struct {
	Home     PageSEO `json:"home"`
	Projects PageSEO `json:"projects"`
	About    PageSEO `json:"about"`
}
type SocialLink struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}
type Settings struct {
	SiteTitle             string       `json:"siteTitle"`
	SiteDescription       string       `json:"siteDescription"`
	DefaultSEODescription string       `json:"defaultSeoDescription"`
	HomeIntroduction      []string     `json:"homeIntroduction"`
	FooterText            string       `json:"footerText"`
	DefaultShareAssetID   *string      `json:"defaultShareAssetId"`
	SocialLinks           []SocialLink `json:"socialLinks"`
	Pages                 PageSEOSet   `json:"pages"`
}

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)
var tagPattern = regexp.MustCompile(`(?i)<\s*/?\s*[a-z!][^>]*>`)
var hostnameLabelPattern = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$`)
var numericHostEndPattern = regexp.MustCompile(`^(?:[0-9]+|0x[0-9a-f]*)$`)

// DNS labels use their ASCII representation; IDNs must be supplied as reviewed
// punycode. Numeric final labels are rejected because WHATWG URL parsers may
// reinterpret forms such as 127.1 or 0x7f.0.0.1 as legacy IPv4 addresses.
func publicHost(host string) bool {
	if ip := net.ParseIP(host); ip != nil {
		return ip.IsGlobalUnicast() && !ip.IsPrivate() && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() && !ip.IsUnspecified()
	}
	if len(host) > 253 || !strings.Contains(host, ".") || host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") || strings.HasSuffix(host, ".test") || strings.HasSuffix(host, ".invalid") {
		return false
	}
	labels := strings.Split(host, ".")
	if numericHostEndPattern.MatchString(labels[len(labels)-1]) {
		return false
	}
	for _, label := range labels {
		if len(label) < 1 || len(label) > 63 || !hostnameLabelPattern.MatchString(label) {
			return false
		}
	}
	return true
}

func Slug(value string) bool {
	return len(value) >= 1 && len(value) <= 64 && slugPattern.MatchString(value)
}
func Text(value string, min, max int, multiline bool) bool {
	if !utf8.ValidString(value) || utf8.RuneCountInString(value) < min || utf8.RuneCountInString(value) > max || (min > 0 && strings.TrimSpace(value) == "") || tagPattern.MatchString(value) {
		return false
	}
	for _, r := range value {
		if unicode.IsControl(r) && !(multiline && (r == '\n' || r == '\t')) {
			return false
		}
	}
	return true
}
func stringsValid(values []string, count, size int, min int) bool {
	if values == nil || len(values) > count {
		return false
	}
	seen := map[string]bool{}
	for _, value := range values {
		if !Text(value, min, size, true) || seen[value] {
			return false
		}
		seen[value] = true
	}
	return true
}

// PublicURL performs parsing only; it never resolves DNS or fetches a URL.
func PublicURL(value string, email bool) bool {
	if len(value) > 2048 || strings.TrimSpace(value) != value || strings.IndexFunc(value, unicode.IsControl) >= 0 {
		return false
	}
	if email && strings.HasPrefix(value, "mailto:") {
		address := strings.TrimPrefix(value, "mailto:")
		parsed, err := mail.ParseAddress(address)
		return err == nil && parsed.Address == address && !strings.ContainsAny(address, "?#")
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.User != nil || u.Host == "" || u.Opaque != "" || u.Port() != "" && u.Port() != "443" {
		return false
	}
	host := strings.ToLower(strings.TrimSuffix(u.Hostname(), "."))
	if !publicHost(host) {
		return false
	}
	for _, part := range strings.Split(strings.ToLower(u.Path), "/") {
		if part == "admin" || part == "administrator" || part == "wp-admin" {
			return false
		}
	}
	return !strings.ContainsAny(u.Host, "\\%")
}
func ValidateProject(p ProjectInput) error {
	if !Slug(p.Slug) {
		return invalid("slug")
	}
	if !Text(p.Name, 1, 80, false) {
		return invalid("name")
	}
	if !Text(p.Summary, 1, 500, true) {
		return invalid("summary")
	}
	if !Text(p.Description, 0, 20000, true) {
		return invalid("description")
	}
	if !Slug(p.Category) {
		return invalid("category")
	}
	if !stringsValid(p.TechStack, 20, 40, 1) {
		return invalid("techStack")
	}
	if p.Status != "unconfirmed" && p.Status != "planning" && p.Status != "in-development" && p.Status != "live" && p.Status != "maintained" {
		return invalid("status")
	}
	if p.Featured == nil || p.Visible == nil || p.IsPlaceholder == nil {
		return invalid("featured/visible/isPlaceholder")
	}
	if !Text(p.CoverAlt, 1, 200, true) {
		return invalid("coverAlt")
	}
	if p.CoverKind != "placeholder" && p.CoverKind != "screenshot" {
		return invalid("coverKind")
	}
	if !validReference(p.Cover) {
		return invalid("cover")
	}
	for _, value := range []*string{p.DemoURL, p.RepositoryURL} {
		if value != nil && !PublicURL(*value, false) {
			return invalid("projectUrl")
		}
	}
	return nil
}
func validReference(r Reference) bool {
	return (r.Kind == "builtin" || r.Kind == "media") && len(r.ID) > 0 && len(r.ID) <= 80 && !strings.ContainsAny(r.ID, "/\\.\x00")
}
func ValidateProfile(p Profile) error {
	if !Text(p.Site.Name, 1, 80, false) || !Text(p.Site.Role, 1, 120, false) || !stringsValid(p.Site.Introduction, 8, 500, 1) || !stringsValid(p.Site.Directions, 10, 40, 1) || !stringsValid(p.Site.Technologies, 30, 40, 1) {
		return invalid("site")
	}
	if p.Site.GitHubURL != nil && !PublicURL(*p.Site.GitHubURL, false) {
		return invalid("githubUrl")
	}
	for _, id := range []*string{p.Site.AvatarAssetID, p.Site.BrandAssetID} {
		if id != nil && !validReference(Reference{Kind: "media", ID: *id}) {
			return invalid("brand/avatar")
		}
	}
	a := p.About
	if !Text(a.BrandIntroduction, 1, 1000, true) || !stringsValid(a.PersonalIntroduction, 12, 1000, 1) || a.Capabilities == nil || len(a.Capabilities) > 10 || a.Principles == nil || len(a.Principles) > 10 || a.Contacts == nil || len(a.Contacts) > 10 {
		return invalid("about")
	}
	for _, c := range a.Capabilities {
		if !Text(c.Title, 1, 80, false) || !stringsValid(c.Technologies, 30, 40, 1) {
			return invalid("capabilities")
		}
	}
	for _, v := range a.Principles {
		if !Text(v.Title, 1, 80, false) || !Text(v.Description, 1, 500, true) {
			return invalid("principles")
		}
	}
	for _, c := range a.Contacts {
		if !Text(c.Label, 1, 80, false) || !Text(c.Description, 0, 300, true) || !PublicURL(c.URL, true) {
			return invalid("contacts")
		}
	}
	if a.Resume != nil && (!Text(a.Resume.Label, 1, 80, false) || !PublicURL(a.Resume.URL, false)) {
		return invalid("resume")
	}
	return nil
}
func ValidateSettings(s Settings) error {
	if !Text(s.SiteTitle, 1, 100, false) || !Text(s.SiteDescription, 1, 300, true) || !Text(s.DefaultSEODescription, 1, 300, true) || !stringsValid(s.HomeIntroduction, 8, 500, 1) || !Text(s.FooterText, 0, 300, true) || s.SocialLinks == nil || len(s.SocialLinks) > 10 {
		return invalid("settings")
	}
	for _, link := range s.SocialLinks {
		if !Text(link.Label, 1, 80, false) || !PublicURL(link.URL, false) {
			return invalid("socialLinks")
		}
	}
	for _, p := range []PageSEO{s.Pages.Home, s.Pages.Projects, s.Pages.About} {
		if p.Title != "" && !Text(p.Title, 1, 100, false) || p.Description != "" && !Text(p.Description, 1, 300, true) || p.ShareAssetID != nil && !validReference(Reference{Kind: "media", ID: *p.ShareAssetID}) {
			return invalid("pages")
		}
	}
	if s.DefaultShareAssetID != nil && !validReference(Reference{Kind: "media", ID: *s.DefaultShareAssetID}) {
		return invalid("defaultShareAssetId")
	}
	return nil
}

func jsonString(value any) string { data, _ := json.Marshal(value); return string(data) }
func nullableString(v *string) any {
	if v == nil {
		return nil
	}
	return *v
}
func DBError(err error) error {
	if err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed") {
		return conflict("CONTENT_CONFLICT", "名称标识或排序状态冲突，请刷新后重试。")
	}
	return err
}
func Revision(value int64) string { return fmt.Sprintf("ws-%d", value) }
