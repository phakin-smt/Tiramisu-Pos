"""Build PromptPay merchant-presented QR payloads without an external API."""

import re
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP


PROMPTPAY_GUID = "A000000677010111"
MAX_AMOUNT = Decimal("999999.99")


class PromptPayError(ValueError):
    """Raised when a PromptPay target or amount is invalid."""


def _tlv(tag, value):
    if len(value) > 99:
        raise PromptPayError("PromptPay field is too long")
    return f"{tag}{len(value):02d}{value}"


def _crc16_xmodem(value):
    crc = 0xFFFF
    for byte in value.encode("ascii"):
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return f"{crc:04X}"


def _normalize_target(target):
    raw = str(target or "").strip()
    digits = re.sub(r"\D", "", raw)
    if raw.startswith("+66") and len(digits) == 11:
        digits = "0" + digits[2:]
    if len(digits) == 10 and digits.startswith("0"):
        return "01", "0066" + digits[1:]
    if len(digits) == 13:
        return "02", digits
    raise PromptPayError("PROMPTPAY_ID must be a Thai mobile number or 13-digit ID")


def parse_amount(value):
    try:
        amount = Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    except (InvalidOperation, TypeError, ValueError):
        raise PromptPayError("Payment amount is invalid") from None
    if not Decimal("0.01") <= amount <= MAX_AMOUNT:
        raise PromptPayError("Payment amount must be between 0.01 and 999999.99")
    return amount


def generate_promptpay_payload(target, amount):
    """Return an EMVCo Thai QR Payment payload with a fixed THB amount."""
    target_tag, normalized_target = _normalize_target(target)
    parsed_amount = parse_amount(amount)
    merchant = _tlv("00", PROMPTPAY_GUID) + _tlv(target_tag, normalized_target)
    body = "".join((
        _tlv("00", "01"),
        _tlv("01", "12"),
        _tlv("29", merchant),
        _tlv("58", "TH"),
        _tlv("53", "764"),
        _tlv("54", f"{parsed_amount:.2f}"),
    ))
    crc_input = body + "6304"
    return crc_input + _crc16_xmodem(crc_input)
