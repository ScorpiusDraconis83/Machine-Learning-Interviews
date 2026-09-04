from __future__ import annotations

import unittest
from pathlib import PurePosixPath
from unittest import mock

from scripts import sync_translations as sync


class TranslationManifestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = sync.load_manifest()

    def test_root_and_behavior_overrides(self) -> None:
        zh = self.manifest.languages["zh-CN"]
        fa = self.manifest.languages["fa-IR"]
        self.assertEqual(
            sync.target_for(PurePosixPath("README.md"), zh, self.manifest),
            PurePosixPath("README-CN.md"),
        )
        self.assertEqual(
            sync.target_for(
                PurePosixPath("src/behavioral/behavior.md"), zh, self.manifest
            ),
            PurePosixPath("cn/src/behavior.md"),
        )
        self.assertEqual(
            sync.target_for(
                PurePosixPath("src/behavioral/behavior.md"), fa, self.manifest
            ),
            PurePosixPath("fa/src/behavioral/behavior.md"),
        )

    def test_default_mapping_mirrors_source_tree(self) -> None:
        fa = self.manifest.languages["fa-IR"]
        self.assertEqual(
            sync.target_for(
                PurePosixPath("src/MLSD/mlsd-search.md"), fa, self.manifest
            ),
            PurePosixPath("fa/src/MLSD/mlsd-search.md"),
        )


class ChangeDetectionTests(unittest.TestCase):
    @mock.patch.object(sync, "run_git")
    def test_only_selects_added_or_modified_english_markdown(self, run_git) -> None:
        run_git.return_value = (
            "M\tsrc/ml-fundamental.md\n"
            "M\tfa/README.md\n"
            "A\tsrc/genai-resources.md"
        )
        self.assertEqual(
            sync.changed_sources("base", "head"),
            [
                PurePosixPath("src/genai-resources.md"),
                PurePosixPath("src/ml-fundamental.md"),
            ],
        )

    @mock.patch.object(sync, "run_git")
    def test_deletion_requires_manual_review(self, run_git) -> None:
        run_git.return_value = "D\tsrc/old.md"
        with self.assertRaisesRegex(sync.SyncError, "deletion or rename"):
            sync.changed_sources("base", "head")


class ValidationTests(unittest.TestCase):
    def test_valid_chinese_structure_passes(self) -> None:
        source = (
            "# Heading\n\n| A | B |\n| --- | --- |\n| x | y |\n\n"
            "```python\nprint('x')\n```\n\n[Guide](https://example.com/guide)"
        )
        translated = (
            "# 标题\n\n| 甲 | 乙 |\n| --- | --- |\n| 一 | 二 |\n\n"
            "```python\nprint('x')\n```\n\n[指南](https://example.com/guide)"
        )
        self.assertEqual(sync.validate_structure(source, translated, "zh-CN"), [])

    def test_missing_url_and_heading_are_reported(self) -> None:
        source = "# Heading\n\n[Guide](https://example.com/guide)"
        translated = "没有标题，也没有链接。"
        errors = sync.validate_structure(source, translated, "zh-CN")
        self.assertTrue(any("heading" in error for error in errors))
        self.assertTrue(any("missing external" in error for error in errors))

    def test_farsi_preferred_terms_are_enforced_in_prose_only(self) -> None:
        source = "# Topic\n\nResearch with `GenAI`."
        translated = "# موضوع\n\nResearch با `GenAI`."
        errors = sync.validate_structure(source, translated, "fa-IR")
        self.assertTrue(any("untranslated preferred terms" in error for error in errors))

    def test_future_local_path_is_accepted(self) -> None:
        errors = sync.validate_local_links(
            PurePosixPath("fa/src/index.md"),
            "[بعدی](next.md)",
            {PurePosixPath("fa/src/next.md")},
        )
        self.assertEqual(errors, [])

    def test_broken_and_escaping_links_are_rejected(self) -> None:
        broken = sync.validate_local_links(
            PurePosixPath("fa/src/index.md"), "[گمشده](missing.md)"
        )
        escaping = sync.validate_local_links(
            PurePosixPath("README-FA.md"), "[بیرون](../../outside.md)"
        )
        self.assertTrue(any("broken" in error for error in broken))
        self.assertTrue(any("escapes" in error for error in escaping))

    def test_response_text_is_extracted_from_message_items(self) -> None:
        payload = {
            "status": "completed",
            "output": [
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": "translated"}],
                }
            ]
        }
        self.assertEqual(sync.response_output_text(payload), "translated")

    def test_incomplete_response_is_rejected(self) -> None:
        with self.assertRaisesRegex(sync.SyncError, "incomplete"):
            sync.response_output_text(
                {"status": "incomplete", "incomplete_details": {"reason": "limit"}}
            )

    def test_markdown_wrapper_is_removed(self) -> None:
        self.assertEqual(sync.strip_wrapping_fence("```markdown\n# 标题\n```"), "# 标题")


if __name__ == "__main__":
    unittest.main()
