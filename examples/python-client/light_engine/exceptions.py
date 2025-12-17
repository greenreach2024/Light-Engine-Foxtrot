"""Exception classes for Light Engine SDK"""


class LightEngineError(Exception):
    """Base exception for all Light Engine SDK errors"""
    pass


class APIError(LightEngineError):
    """API request failed with error response"""
    
    def __init__(self, message: str, status_code: int = None, detail: str = None):
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail or message


class TimeoutError(LightEngineError):
    """Request timed out"""
    pass


class AuthenticationError(LightEngineError):
    """Authentication failed"""
    pass


class ValidationError(LightEngineError):
    """Request validation failed"""
    pass
