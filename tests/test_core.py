"""Fast checks that do not require gated model files or a dataset."""

import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "experiments"))
import adaptive_soft_regions as region  # noqa: E402


class RegionChecks(unittest.TestCase):
    def setUp(self):
        self.features = np.ones((region.GRID, region.GRID, 4), np.float32) / 2

    def test_196_unique_cores(self):
        for strategy in ("grid", "edge", "medoid"):
            with self.subTest(strategy=strategy):
                seeds, edges = region.seed_positions(self.features, strategy)
                self.assertEqual(len(seeds), 196)
                self.assertEqual(len(set(seeds)), 196)
                self.assertEqual(edges is None, strategy != "edge")

    def test_feature_edges(self):
        result = region.feature_edges(self.features, region.GRID)
        self.assertEqual(result.shape, (28, 28))
        self.assertTrue(np.allclose(result, 0))


if __name__ == "__main__":
    unittest.main()
