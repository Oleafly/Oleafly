# Oleafly's Windows sandbox shim.
#
# Since the fix for CVE-2024-4030 (Python 3.12.4, 3.11.10, 3.10.15, 3.9.20
# and 3.13), os.mkdir(path, 0o700) gives the new folder a private access list
# that leaves out the AppContainer. tempfile.mkdtemp, TemporaryDirectory, pip
# and pytest then fail inside the sandbox (cpython issue 134587). Inside
# Oleafly's sandbox only, mode 0o700 is mapped to the folder's inherited
# access list. Then the next sitecustomize on sys.path runs as usual.
import os
import sys

if os.name == "nt" and os.environ.get("OLEAFLY_SANDBOX") == "appcontainer":
    _oleafly_mkdir = os.mkdir

    def _oleafly_sandbox_mkdir(path, mode=0o777, *args, **kwargs):
        if mode == 0o700:
            mode = 0o777
        return _oleafly_mkdir(path, mode, *args, **kwargs)

    os.mkdir = _oleafly_sandbox_mkdir

    try:
        import importlib.machinery
        import importlib.util

        _here = os.path.dirname(os.path.abspath(__file__))
        _rest = [entry for entry in sys.path if os.path.abspath(entry or ".") != _here]
        _spec = importlib.machinery.PathFinder.find_spec("sitecustomize", _rest)
        if _spec is not None and _spec.loader is not None:
            _module = importlib.util.module_from_spec(_spec)
            _spec.loader.exec_module(_module)
    except Exception:
        pass
