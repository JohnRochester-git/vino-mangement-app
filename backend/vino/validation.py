"""Input validation. Every rule the API enforces lives here.

Endpoints describe their body as a dict of field name -> Field, then call
validate(body, spec). Problems are collected per field and raised together
as one 400 validation_error, so the frontend can show every message at once.
"""

import re
import unicodedata
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, InvalidOperation

from .errors import ValidationError
from .util import iso, today

WINE_TYPES = ("Red", "White", "Rosé", "Sparkling", "Dessert", "Fortified", "Orange")
MAX_MONEY_CENTS = 10_000_000 * 100
MAX_QUANTITY = 9999

_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class FieldError(Exception):
    pass


class Field:
    """One allowed field in a request body.

    parse: function(value) -> cleaned value; raises FieldError with a message.
    required: must be present and not null (ignored for partial updates).
    nullable: may be sent as null to clear it.
    """

    def __init__(self, parse, required=False, nullable=True):
        self.parse = parse
        self.required = required
        self.nullable = nullable and not required


def validate(data, spec, partial=False):
    """Check `data` against `spec`. Returns only the fields that were sent
    (plus None for required fields in full mode). Raises ValidationError."""
    errors, clean = {}, {}
    for name in data:
        if name not in spec:
            errors[name] = f"Unknown field '{name}'."
    for name, field in spec.items():
        if name not in data:
            if field.required and not partial:
                errors[name] = "This field is required."
            continue
        value = data[name]
        if value is None or (isinstance(value, str) and value.strip() == "" and field.nullable):
            if field.nullable:
                clean[name] = None
            else:
                errors[name] = "This field is required."
            continue
        try:
            clean[name] = field.parse(value)
        except FieldError as err:
            errors[name] = str(err)
    if errors:
        raise ValidationError(errors)
    return clean


def check(errors):
    """Raise a ValidationError for cross-field problems found by the caller."""
    if errors:
        raise ValidationError(errors)


# ---- Text -------------------------------------------------------------------

def clean_text(value, keep_newlines=False):
    if not isinstance(value, str):
        raise FieldError("Must be text.")
    allowed = "\n\t" if keep_newlines else ""
    value = "".join(
        ch for ch in value
        if ch in allowed or unicodedata.category(ch) not in ("Cc", "Cf", "Cs", "Co")
    )
    if keep_newlines:
        value = value.replace("\r\n", "\n")
    return value.strip()


def text(min_len=0, max_len=120, label="This", multiline=False):
    def parse(value):
        value = clean_text(value, keep_newlines=multiline)
        if len(value) < min_len:
            raise FieldError(f"{label} is required." if min_len == 1 else f"{label} must be at least {min_len} characters.")
        if len(value) > max_len:
            raise FieldError(f"{label} must be at most {max_len:,} characters.")
        return value
    return parse


def name_field(label):
    return text(1, 50, label)


def email(value):
    value = clean_text(value).lower()
    if len(value) > 254:
        raise FieldError("Email must be at most 254 characters.")
    if not _EMAIL_RE.match(value):
        raise FieldError("Enter a valid email address.")
    return value


def password(value):
    if not isinstance(value, str):
        raise FieldError("Must be text.")
    if len(value) < 8:
        raise FieldError("Password must be at least 8 characters.")
    if len(value) > 200:
        raise FieldError("Password must be at most 200 characters.")
    return value


def login_password(value):
    # At login, any non-empty password is checked; length rules are for signup.
    if not isinstance(value, str) or not value or len(value) > 200:
        raise FieldError("Enter your password.")
    return value


# ---- Wine -------------------------------------------------------------------

def wine_type(value):
    if isinstance(value, str):
        wanted = clean_text(value).lower()
        for t in WINE_TYPES:
            if wanted in (t.lower(), unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()):
                return t
    raise FieldError(f"Wine type must be one of: {', '.join(WINE_TYPES)}.")


def max_vintage():
    return today().year + 1


def vintage(value):
    n = _int(value, "Vintage must be a whole number.")
    if not 1800 <= n <= max_vintage():
        raise FieldError(f"Vintage must be between 1800 and {max_vintage()}.")
    return n


def barcode(value):
    """UPC/EAN/GTIN: 8, 12, 13 or 14 digits with a valid check digit.

    Stored in a canonical form so a UPC-A (12 digits) and the same code as an
    EAN-13 (with a leading 0) match: 12 digits gain a leading 0, and 14 digits
    starting with 0 drop it.
    """
    if isinstance(value, int) and not isinstance(value, bool):
        raise FieldError("Send the barcode as text so leading zeros are kept.")
    if not isinstance(value, str):
        raise FieldError("Barcode must be text.")
    code = value.strip().replace(" ", "").replace("-", "")
    if not code.isdigit() or not code.isascii():
        raise FieldError("Barcode must contain digits only.")
    if len(code) not in (8, 12, 13, 14):
        raise FieldError("Barcode must be 8, 12, 13 or 14 digits long.")
    if not gtin_check_digit_ok(code):
        raise FieldError("That barcode's check digit is wrong. Check the number and try again.")
    if len(code) == 12:
        code = "0" + code
    elif len(code) == 14 and code.startswith("0"):
        code = code[1:]
    return code


def gtin_check_digit_ok(code):
    digits = [int(c) for c in code]
    body, check_digit = digits[:-1], digits[-1]
    total = sum(d * (3 if i % 2 == 0 else 1) for i, d in enumerate(reversed(body)))
    return (10 - total % 10) % 10 == check_digit


# ---- Numbers and money --------------------------------------------------------

def _int(value, message):
    if isinstance(value, bool):
        raise FieldError(message)
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and re.fullmatch(r"\s*-?\d+\s*", value):
        return int(value)
    raise FieldError(message)


def quantity(min_value=1):
    def parse(value):
        n = _int(value, "Quantity must be a whole number.")
        if not min_value <= n <= MAX_QUANTITY:
            raise FieldError(f"Quantity must be between {min_value} and {MAX_QUANTITY:,}.")
        return n
    return parse


def positive_id(value):
    n = _int(value, "Must be a whole-number id.")
    if n < 1:
        raise FieldError("Must be a positive id.")
    return n


def money(value):
    """Dollars in (number or numeric text) -> integer cents out."""
    if isinstance(value, bool):
        raise FieldError("Enter an amount in dollars, like 24.99.")
    try:
        amount = Decimal(str(value).strip().replace(",", "").lstrip("$"))
    except (InvalidOperation, ValueError):
        raise FieldError("Enter an amount in dollars, like 24.99.") from None
    if not amount.is_finite():
        raise FieldError("Enter an amount in dollars, like 24.99.")
    if amount < 0:
        raise FieldError("Amount can't be negative.")
    if amount > 10_000_000:
        raise FieldError("Amount must be at most $10,000,000.")
    if amount != amount.quantize(Decimal("0.01")):
        raise FieldError("Amount can have at most 2 decimal places.")
    return int(amount * 100)


def rating(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise FieldError("Rating must be a number from 1 to 5.")
    if not 1 <= value <= 5 or (value * 2) != int(value * 2):
        raise FieldError("Rating must be from 1 to 5 in half-star steps.")
    return float(value)


def int_range(low, high, label):
    def parse(value):
        n = _int(value, f"{label} must be a whole number.")
        if not low <= n <= high:
            raise FieldError(f"{label} must be between {low} and {high}.")
        return n
    return parse


# ---- Dates ------------------------------------------------------------------

def iso_date(value):
    if not isinstance(value, str) or not _DATE_RE.match(value.strip()):
        raise FieldError("Use the date format YYYY-MM-DD.")
    try:
        return date.fromisoformat(value.strip()).isoformat()
    except ValueError:
        raise FieldError("That date doesn't exist.") from None


def past_date(value):
    value = iso_date(value)
    if date.fromisoformat(value) > today():
        raise FieldError("Date can't be in the future.")
    return value


def past_timestamp(value):
    """A date or date-time, not in the future -> UTC ISO timestamp text."""
    if not isinstance(value, str):
        raise FieldError("Use a date (YYYY-MM-DD) or date-time (ISO 8601).")
    text_value = value.strip()
    try:
        if _DATE_RE.match(text_value):
            dt = datetime.fromisoformat(text_value + "T12:00:00").replace(tzinfo=timezone.utc)
        else:
            dt = datetime.fromisoformat(text_value.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
    except ValueError:
        raise FieldError("Use a date (YYYY-MM-DD) or date-time (ISO 8601).") from None
    if dt > datetime.now(timezone.utc) + timedelta(minutes=5):
        raise FieldError("This can't be in the future.")
    if dt.year < 1900:
        raise FieldError("That date is too far in the past.")
    return iso(dt)


def check_window(errors, drink_from, drink_by):
    if drink_from and drink_by and drink_from > drink_by:
        errors["itemDrinkFrom"] = "Drink-from date must be on or before the drink-by date."


# ---- Lists ------------------------------------------------------------------

def name_list(max_items=20):
    def parse(value):
        if not isinstance(value, list) or len(value) > max_items:
            raise FieldError(f"Must be a list of up to {max_items} names.")
        out = []
        for item in value:
            if not isinstance(item, str) or not clean_text(item):
                raise FieldError("Each entry must be a name.")
            out.append(clean_text(item))
        return out
    return parse


def query_param(args, name, parse, default=None):
    """Validate one query-string parameter, raising a 400 with its name."""
    value = args.get(name)
    if value is None or value == "":
        return default
    try:
        return parse(value)
    except FieldError as err:
        raise ValidationError({name: str(err)}) from None
