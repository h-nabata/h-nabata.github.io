import logging
from pathlib import Path

def setup_logger(log_file: Path) -> logging.Logger:
    logger=logging.getLogger(str(log_file))
    logger.setLevel(logging.INFO)
    fh=logging.FileHandler(log_file)
    logger.addHandler(fh)
    return logger
