def is_available() -> bool:
    try:
        import openbabel  # noqa
        return True
    except Exception:
        return False
