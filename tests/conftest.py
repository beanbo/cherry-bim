import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "examples" / "demo"))


@pytest.fixture(scope="session")
def demo():
    from build_demo import build
    return build()


@pytest.fixture(scope="session")
def twin(demo):
    from cherrybim import Twin
    return Twin(list(demo))
