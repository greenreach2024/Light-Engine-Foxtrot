import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from recipe_bridge import (
    clamp_minutes,
    clamp_percent,
    normalize_seed_date,
    parse_duration_hours,
    parse_time_of_day,
)


def test_parse_duration_hours_handles_fractional_formats():
    assert parse_duration_hours("16/8") == 16
    assert parse_duration_hours("18 hrs") == 18
    assert parse_duration_hours(25) == 24


def test_parse_time_of_day_normalizes_output():
    assert parse_time_of_day("8:30 PM") == "20:30"
    assert parse_time_of_day(dt.time(7, 0, 59)) == "07:00"
    assert parse_time_of_day(8.5) == "08:30"


def test_normalize_seed_date_accepts_various_formats():
    assert normalize_seed_date("10/01/25") == "2025-10-01"
    assert normalize_seed_date(dt.datetime(2024, 5, 6, 10, 0)) == "2024-05-06"


def test_percent_and_minutes_clamping():
    assert clamp_percent(123.4567) == 100.0
    assert clamp_percent(-5) == 0.0
    assert clamp_minutes(200) == 120
    assert clamp_minutes(-5) == 0
