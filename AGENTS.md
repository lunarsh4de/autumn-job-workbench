# Repository Guide

## Project layout

- `resume-quick-apply/` contains the browser extension and its Node.js test suite.
- `build_resume.py` and `build_truthful_resume.py` generate resume documents.
- `output/` and `.codex-tmp/` are generated or temporary data and are not versioned.

## Worktree setup

Run dependency installation from the extension directory when `node_modules/` is absent:

```powershell
cd resume-quick-apply
npm ci
```

Do not copy `node_modules/` between worktrees. Each worktree should install dependencies from the committed lockfile.

## Verification

After changing the extension, run:

```powershell
cd resume-quick-apply
npm test
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install\Install-ResumeQuickApply.ps1 -ValidateOnly
```

After changing either resume generator, run:

```powershell
python -m py_compile build_resume.py build_truthful_resume.py
```

Keep generated resumes, release archives, browser profiles, screenshots, and render caches under `output/` or `.codex-tmp/`.
