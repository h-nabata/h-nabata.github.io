def is_available() -> bool:
    try:
        import rdkit  # noqa
        return True
    except Exception:
        return False
