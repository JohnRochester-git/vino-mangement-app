from datetime import date

import pytest

from vino.services.drink_window import ESTIMATE_YEARS, RuleBasedEstimator, drink_status


@pytest.mark.parametrize("wine_type,start,end", [(t, s, e) for t, (s, e) in ESTIMATE_YEARS.items()])
def test_estimate_each_type(wine_type, start, end):
    f, b, source = RuleBasedEstimator().window(wine_type, 2020, None)
    assert f == f"{2020 + start}-01-01" and b == f"{2020 + end}-12-31" and source == "estimate"


def test_estimate_non_vintage_counts_from_acquired():
    assert RuleBasedEstimator().window("Sparkling", None, "2024-02-29") == ("2025-02-28", "2029-02-28", "estimate")
    assert RuleBasedEstimator().window("Rosé", None, "2026-03-01") == ("2026-03-01", "2028-03-01", "estimate")


def test_estimate_unknown_type():
    assert RuleBasedEstimator().window("Beer", 2020) == (None, None, None)


F, B = "2026-01-01", "2026-12-31"


@pytest.mark.parametrize("today,expected", [
    (date(2025, 12, 31), "tooYoung"),
    (date(2026, 1, 1), "ready"),        # first day of the window
    (date(2026, 7, 3), "ready"),        # 181 days before drink-by
    (date(2026, 7, 4), "drinkSoon"),    # exactly 180 days before
    (date(2026, 12, 31), "drinkSoon"),  # last day of the window
    (date(2027, 1, 1), "pastPeak"),
])
def test_status_boundaries(today, expected):
    assert drink_status(F, B, today, 180) == expected


def test_status_partial_and_missing_windows():
    assert drink_status(None, None, date(2026, 1, 1)) == "notSet"
    assert drink_status("2030-01-01", None, date(2026, 1, 1)) == "tooYoung"
    assert drink_status("2020-01-01", None, date(2026, 1, 1)) == "ready"
    assert drink_status(None, "2020-01-01", date(2026, 1, 1)) == "pastPeak"
    assert drink_status(F, B, date(2026, 12, 1), soon_days=0) == "ready"
