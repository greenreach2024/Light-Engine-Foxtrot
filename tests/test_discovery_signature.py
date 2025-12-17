import inspect
from backend import device_discovery


def test_full_discovery_accepts_logger():
    # Ensure full_discovery_cycle accepts an optional logger kwarg
    sig = inspect.signature(device_discovery.full_discovery_cycle)
    params = sig.parameters
    assert 'logger' in params, 'full_discovery_cycle must accept a logger kwarg'
    # Should be optional
    assert params['logger'].default is None
