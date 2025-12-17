package lightengine

import "fmt"

// Error represents an API error
type Error struct {
	StatusCode int
	Message    string
	Detail     string
}

// Error implements the error interface
func (e *Error) Error() string {
	if e.Detail != "" {
		return fmt.Sprintf("API error (status %d): %s - %s", e.StatusCode, e.Message, e.Detail)
	}
	return fmt.Sprintf("API error (status %d): %s", e.StatusCode, e.Message)
}

// NewError creates a new API error
func NewError(statusCode int, message, detail string) *Error {
	return &Error{
		StatusCode: statusCode,
		Message:    message,
		Detail:     detail,
	}
}

// IsNotFound returns true if the error is a 404 Not Found error
func IsNotFound(err error) bool {
	if apiErr, ok := err.(*Error); ok {
		return apiErr.StatusCode == 404
	}
	return false
}

// IsUnauthorized returns true if the error is a 401 Unauthorized error
func IsUnauthorized(err error) bool {
	if apiErr, ok := err.(*Error); ok {
		return apiErr.StatusCode == 401
	}
	return false
}

// IsBadRequest returns true if the error is a 400 Bad Request error
func IsBadRequest(err error) bool {
	if apiErr, ok := err.(*Error); ok {
		return apiErr.StatusCode == 400
	}
	return false
}
