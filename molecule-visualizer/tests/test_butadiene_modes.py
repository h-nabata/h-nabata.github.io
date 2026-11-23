"""Angular response of a labelled CH2 pair is independent of eigenvector phase and H labels."""
import unittest

import numpy as np
from benchmark_butadiene import band
from benchmark_butadiene_modes import terminal_angular_response


class AngularResponse(unittest.TestCase):
    def test_phase_rotation_and_terminal_relabelling(self):
        # The open endpoint is planar. Exchanging the labels of one CH2 places
        # its reference angle at ±180°, exactly on the atan2 branch cut.
        _, images = band('free', 0)
        p = images[0]
        mode = np.zeros_like(p)
        for end, middle, hs, magnitude in [(0, 1, [4, 5], 1), (3, 2, [8, 9], .6)]:
            axis = p[end]-p[middle]
            mode[hs] = magnitude*np.cross(axis/np.linalg.norm(axis), p[hs]-p[end])

        response = terminal_angular_response(p, mode)
        self.assertGreater(response[0], 1)
        self.assertLess(response[1], -1)
        np.testing.assert_allclose(response, terminal_angular_response(p, -mode))
        order = [0, 1, 2, 3, 4, 5, 6, 7, 9, 8]
        np.testing.assert_allclose(response, terminal_angular_response(p[order], mode[order]))
        np.testing.assert_allclose(response, terminal_angular_response(p[:, [2, 0, 1]] + 3, mode[:, [2, 0, 1]]))
