import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/backfill-awg-source-gallery.py"
spec = importlib.util.spec_from_file_location("awg_gallery_backfill", SCRIPT)
gallery = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gallery)

def photo(post, position):
    kind = "main" if position == 1 else "other"
    return (f"https://storage.yandexcloud.net/viiversion-autoworld-awg-media/"
            f"cars/autoworld-{post}/{kind}-1790000000000-{kind}-{position}-aabbccdd.jpg")

def car(post="4394", positions=range(1, 8)):
    return {"id": "AWG-" + post, "source": "AutoWorld_Georgia",
            "sourcePostId": post, "vin": "WP1AA2A50RLB18308",
            "image": photo(post, 1),
            "otherPhotos": [photo(post, p) for p in positions if p != 1],
            "interiorPhotos": [], "active": True, "priceRub": 5380000,
            "managerNote": "do not alter"}

class GallerySafetyTests(unittest.TestCase):
    def test_seven_of_ten_needs_only_last_three(self):
        p = gallery.build_plan(car(), ["https://source/" + str(i) for i in range(10)])
        self.assertEqual(p["missing"], [8, 9, 10])
        self.assertEqual(p["existing"][1], photo("4394", 1))
        self.assertEqual(p["existing"][7], photo("4394", 7))

    def test_missing_middle_positions_preserve_other_indexes(self):
        p = gallery.build_plan(car(positions=[1, 2, 5]), ["x"] * 7)
        self.assertEqual(p["missing"], [3, 4, 6, 7])

    def test_complete_is_idempotent(self):
        p = gallery.build_plan(car(positions=range(1, 11)), ["x"] * 10)
        self.assertEqual(p["status"], "complete")
        self.assertEqual(p["missing"], [])

    def test_never_delete_photos_if_more_than_source(self):
        p = gallery.build_plan(car(positions=range(1, 9)), ["x"] * 7)
        self.assertEqual(p["status"], "already_more_than_source")

    def test_reject_foreign_photo(self):
        c = car()
        c["otherPhotos"][0] = photo("4381", 2)
        with self.assertRaisesRegex(ValueError, "another_post"):
            gallery.build_plan(c, ["x"] * 10)

    def test_reject_manually_renamed_photo(self):
        c = car()
        c["otherPhotos"][0] = "https://storage.yandexcloud.net/viiversion-autoworld-awg-media/cars/autoworld-4394/manual.jpg"
        with self.assertRaisesRegex(ValueError, "ambiguous"):
            gallery.build_plan(c, ["x"] * 10)

    def test_never_replace_main_photo(self):
        c = car()
        c["image"] = None
        with self.assertRaisesRegex(ValueError, "missing_main"):
            gallery.build_plan(c, ["x"] * 10)

    def test_reject_identity_mismatch(self):
        c = car()
        c["id"] = "AWG-8888"
        with self.assertRaisesRegex(ValueError, "source_identity_invalid"):
            gallery.build_plan(c, ["x"] * 10)

    def test_preview_is_read_only(self):
        from argparse import Namespace
        p = Namespace(apply=False, scope="pilot")
        with tempfile.TemporaryDirectory() as directory:
            p.report = str(Path(directory) / "report.json")
            p.backup = str(Path(directory) / "backup.json")
            with patch.object(gallery, "fetch_state", return_value={
                "AWG-4394": car("4394"), "AWG-4381": car("4381"), "AWG-4370": car("4370")
            }), patch.object(gallery, "lookup_source", return_value=["x"] * 10), \
                patch.object(gallery, "upload_missing", side_effect=AssertionError("upload forbidden")):
                result = gallery.run(p)
                self.assertEqual(result["missingPhotos"], 9)
                self.assertEqual(result["patched"], [])
                self.assertFalse(result["failures"])
                self.assertTrue(Path(p.backup).exists())

    def test_apply_requires_oidc(self):
        from argparse import Namespace
        p = Namespace(apply=True, scope="pilot", report="/tmp/not-written.json",
                      backup="/tmp/not-written-backup.json")
        with patch.dict("os.environ", {"AUTO_SALE_CATALOG_IMPORT_BEARER": ""}):
            with self.assertRaisesRegex(ValueError, "requires_explicit_scope_and_oidc"):
                gallery.run(p)

if __name__ == "__main__":
    unittest.main()
