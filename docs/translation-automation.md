# Translation synchronization

English Markdown is the canonical source. A GitHub Actions workflow watches `README.md` and `src/**/*.md` on `main`. When one of those files changes, it updates the corresponding Simplified Chinese and Persian documents and opens or refreshes a review pull request from `automation/translation-sync`.

## Behavior

- Both locales are updated from the same English commit.
- Existing translations are supplied as a style baseline so unchanged wording is preserved where practical.
- The language guides in `cn/TRANSLATION-GUIDE.md` and `fa/TRANSLATION-GUIDE.md` control terminology and tone.
- Code, formulas, external URLs, Markdown structure, and technical identifiers are preserved.
- Generated files record the exact English source path and commit in an HTML comment.
- Structural and local-link checks run before a pull request is created.
- English file deletion or rename stops the workflow for manual review because canonical path removals may break downstream links.

## Repository configuration

The workflow requires an Actions secret named `OPENAI_API_KEY`. It uses `gpt-5.6-terra` by default; set the repository variable `TRANSLATION_MODEL` to override the model without editing the workflow.

The repository must allow GitHub Actions to create pull requests under **Settings → Actions → General → Workflow permissions**.

## Local commands

Preview which documents would be updated without calling the API:

```bash
python3 scripts/sync_translations.py --base HEAD~1 --head HEAD --plan
```

Run unit tests and validate the manifest/current localized links:

```bash
python3 -m unittest discover -s tests -p "test_*.py"
python3 scripts/sync_translations.py --check
```

Run a small API smoke test without modifying repository files:

```bash
python3 scripts/sync_translations.py --smoke-test
```

## Credential follow-up

The initial rollout may reuse an existing project key. Replace `OPENAI_API_KEY` with a dedicated, least-privilege automation key after the workflow has been validated in production.
