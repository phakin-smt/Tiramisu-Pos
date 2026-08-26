import unittest

from promptpay_qr import PromptPayError, generate_promptpay_payload, parse_amount, promptpay_merchant_account_info


class PromptPayPayloadTests(unittest.TestCase):
    def test_matches_reference_vector_with_amount(self):
        self.assertEqual(
            generate_promptpay_payload("000-000-0000", "4.22"),
            "00020101021229370016A00000067701011101130066000000000"
            "5802TH530376454044.226304E469",
        )

    def test_matches_reference_vector_for_national_id(self):
        payload = generate_promptpay_payload("1-1111-11111-11-1", "4.22")
        self.assertIn("02131111111111111", payload)
        self.assertIn("010212", payload)

    def test_exposes_only_normalized_merchant_account_information(self):
        self.assertEqual(
            promptpay_merchant_account_info("080-123-4567"),
            "0016A00000067701011101130066801234567",
        )

    def test_amount_is_rounded_to_satang(self):
        self.assertEqual(parse_amount("69.995"), parse_amount("70.00"))

    def test_rejects_zero_negative_and_unsupported_target(self):
        for amount in ("0", "-1"):
            with self.assertRaises(PromptPayError):
                generate_promptpay_payload("0801234567", amount)
        with self.assertRaises(PromptPayError):
            generate_promptpay_payload("123", "69")


if __name__ == "__main__":
    unittest.main()
