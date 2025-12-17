"""Unit tests for the SpectraSync helper module."""

from __future__ import annotations

import unittest

from backend.spectrasync import (
    SpectraSyncDecider,
    SpectraSyncDecision,
    SpectraSyncConfig,
    apply_dynamic_recipe,
    apply_static_recipe,
    compute_exceedances,
    compute_scales,
    percentages_to_hex,
)


class SpectraSyncMathTests(unittest.TestCase):
    def test_compute_exceedances_matches_spec(self) -> None:
        config = SpectraSyncConfig()
        e_t, e_rh = compute_exceedances(28.0, 75.0, config)
        self.assertAlmostEqual(e_t, 3.0)
        self.assertAlmostEqual(e_rh, 1.0)

    def test_compute_scales_respects_minimums(self) -> None:
        config = SpectraSyncConfig()
        scales = compute_scales((10.0, 10.0), config)
        self.assertEqual(scales[0], config.coefficients.k_ppfd_min)
        self.assertEqual(scales[1], config.coefficients.k_blue_min)

    def test_static_recipe_scaling(self) -> None:
        baseline = {"cw": 30.0, "ww": 30.0, "bl": 20.0, "rd": 20.0}
        scaled = apply_static_recipe(baseline, 0.6)
        self.assertDictEqual(
            scaled,
            {"cw": 18.0, "ww": 18.0, "bl": 12.0, "rd": 12.0},
        )

    def test_dynamic_recipe_scaling_matches_worked_example(self) -> None:
        baseline = {"cw": 30.0, "ww": 30.0, "bl": 20.0, "rd": 20.0}
        scaled = apply_dynamic_recipe(baseline, 0.6, 0.9)
        self.assertAlmostEqual(scaled["bl"], 18.0, places=3)
        self.assertAlmostEqual(scaled["cw"], 15.75, places=3)
        self.assertAlmostEqual(scaled["ww"], 15.75, places=3)
        self.assertAlmostEqual(scaled["rd"], 10.5, places=3)

    def test_hex_conversion(self) -> None:
        channels = {"cw": 18.0, "ww": 18.0, "bl": 12.0, "rd": 12.0}
        self.assertEqual(percentages_to_hex(channels), "0C0C08080000")


class SpectraSyncDeciderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.decider = SpectraSyncDecider()

    def test_activation_requires_all_guardrails(self) -> None:
        reading = {
            "temperature": 28.0,
            "humidity": 75.0,
            "auto_adjust_lighting": True,
            "hvac_inefficient": True,
        }
        decision = self.decider.evaluate(reading)
        self.assertTrue(decision.active)
        self.assertLess(decision.ppfd_scale, 1.0)
        self.assertLess(decision.blue_scale, 1.0)

    def test_operator_disable_forces_deactivation(self) -> None:
        reading = {
            "temperature": 30.0,
            "humidity": 75.0,
            "auto_adjust_lighting": False,
            "hvac_inefficient": True,
        }
        decision = self.decider.evaluate(reading)
        self.assertFalse(decision.active)
        self.assertEqual(decision.ppfd_scale, 1.0)
        self.assertIn("operator-disabled", decision.reason)

    def test_hysteresis_prevents_early_shutdown(self) -> None:
        activate_reading = {
            "temperature": 28.0,
            "humidity": 75.0,
            "auto_adjust_lighting": True,
            "hvac_inefficient": True,
        }
        recovery_reading = {
            "temperature": 24.95,  # Slightly above deactivate threshold (24+1-0.2)
            "humidity": 66.0,  # Slightly above deactivate threshold (65+5-1)
            "auto_adjust_lighting": True,
            "hvac_inefficient": True,
        }

        active_decision = self.decider.evaluate(activate_reading)
        self.assertTrue(active_decision.active)

        held_decision = self.decider.evaluate(recovery_reading)
        self.assertTrue(held_decision.active)

        # Once conditions re-enter the dead-band minus hysteresis the system stands down.
        final_decision = self.decider.evaluate(
            {
                "temperature": 24.5,
                "humidity": 64.0,
                "auto_adjust_lighting": True,
                "hvac_inefficient": True,
            }
        )
        self.assertFalse(final_decision.active)


if __name__ == "__main__":
    unittest.main()

