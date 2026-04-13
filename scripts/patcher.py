#!/usr/bin/env python3
"""
COREWATCH Branch-Per-Fix Patcher
================================
Uses a local-only git repo inside theme/. Each fix gets its own branch
off the baseline tag. Deploy merges all fix branches via 3-way merge.

Commands (via stdin JSON):
  apply  - Create fix branch, apply diff, commit
  deploy - Merge all fix branches into deploy branch
  status - List all fix branches and their state
"""

import os
import sys
import json
import tempfile
import subprocess

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(SCRIPT_DIR, ".."))
THEME_DIR = os.path.join(PROJECT_ROOT, "theme")
APPLIED_FIXES_FILE = os.path.join(PROJECT_ROOT, "data", "applied-fixes.json")
BASELINE_TAG = "v0-baseline"


def git(*args, cwd=None):
    """Run a git command in the theme directory."""
    cmd = ["git"] + list(args)
    result = subprocess.run(
        cmd,
        cwd=cwd or THEME_DIR,
        capture_output=True,
        text=True
    )
    return result


def load_applied_fixes():
    """Load the applied fixes tracker."""
    if os.path.exists(APPLIED_FIXES_FILE):
        with open(APPLIED_FIXES_FILE, 'r') as f:
            return json.load(f)
    return {"fixes": []}


def save_applied_fixes(data):
    """Save the applied fixes tracker."""
    os.makedirs(os.path.dirname(APPLIED_FIXES_FILE), exist_ok=True)
    with open(APPLIED_FIXES_FILE, 'w') as f:
        json.dump(data, f, indent=2)


def normalize_diff(diff_text, file_path):
    """Normalize a unified diff for git apply compatibility."""
    # Normalize line endings to LF
    diff_text = diff_text.replace('\r\n', '\n')

    lines = diff_text.split('\n')
    rewritten = []
    header_found = False

    for line in lines:
        if line.startswith("--- ") or line.startswith("+++ "):
            header_found = True
            prefix = line[:4]
            rewritten.append(f"{prefix}a/{file_path}" if prefix == "--- " else f"{prefix}b/{file_path}")
        else:
            rewritten.append(line)

    if not header_found:
        rewritten.insert(0, f"--- a/{file_path}")
        rewritten.insert(1, f"+++ b/{file_path}")

    return '\n'.join(rewritten) + '\n'


def get_current_branch():
    """Get the current branch name."""
    r = git("branch", "--show-current")
    return r.stdout.strip() if r.returncode == 0 else "main"


def branch_exists(branch_name):
    """Check if a branch exists."""
    r = git("branch", "--list", branch_name)
    return bool(r.stdout.strip())


def snippet_replace(file_path, original_snippet, fixed_snippet):
    """
    Tier 2: Python-based string replacement.
    Handles CRLF, trimmed match, and anchor-based fuzzy match.
    Returns (success, patched_content_or_error).
    """
    full_path = os.path.join(THEME_DIR, file_path)
    if not os.path.exists(full_path):
        return False, f"File not found: {full_path}"

    content = open(full_path, 'r').read()

    # Attempt 1: Exact match
    if original_snippet in content:
        return True, content.replace(original_snippet, fixed_snippet, 1)

    # Attempt 2: Trimmed match (strip leading/trailing whitespace per line)
    clean_original = original_snippet.strip()
    if clean_original in content:
        return True, content.replace(clean_original, fixed_snippet, 1)

    # Attempt 3: Normalize CRLF in both and try again
    norm_content = content.replace('\r\n', '\n')
    norm_original = original_snippet.replace('\r\n', '\n')
    norm_fixed = fixed_snippet.replace('\r\n', '\n')

    if norm_original in norm_content:
        result = norm_content.replace(norm_original, norm_fixed, 1)
        # Preserve original line endings
        if '\r\n' in content:
            result = result.replace('\n', '\r\n')
        return True, result

    if norm_original.strip() in norm_content:
        result = norm_content.replace(norm_original.strip(), norm_fixed, 1)
        if '\r\n' in content:
            result = result.replace('\n', '\r\n')
        return True, result

    # Attempt 4: Anchor search — find the longest unique line as anchor
    original_lines = norm_original.split('\n')
    clean_lines = [l.strip() for l in original_lines if len(l.strip()) > 8]
    if not clean_lines:
        return False, "No anchor lines found"

    longest = max(clean_lines, key=len)
    content_lines = norm_content.split('\n')
    matches = [i for i, l in enumerate(content_lines) if longest in l]

    if len(matches) == 1:
        anchor_idx = matches[0]
        ai_anchor_idx = next(i for i, l in enumerate(original_lines) if longest in l)
        start = anchor_idx - ai_anchor_idx
        end = start + len(original_lines)
        if 0 <= start and end <= len(content_lines):
            old_block = '\n'.join(content_lines[start:end])
            result = norm_content.replace(old_block, norm_fixed, 1)
            if '\r\n' in content:
                result = result.replace('\n', '\r\n')
            return True, result

    return False, "All string-match strategies failed"


def apply_fix(fix_id, title, diff, file_path, original_snippet=None, fixed_snippet=None):
    """
    Apply a single fix on its own branch.
    Tier 1: git apply (fast path)
    Tier 2: Python snippet replacement (fallback for drifted diffs)
    """
    branch_name = f"fix/{fix_id}"
    original_branch = get_current_branch()

    # Check if this fix branch already exists
    if branch_exists(branch_name):
        return False, f"Fix branch '{branch_name}' already exists. This fix has already been applied."

    # Stash any uncommitted changes
    git("stash", "push", "-m", f"auto-stash-before-{fix_id}")

    try:
        # Create branch from baseline
        r = git("checkout", "-b", branch_name, BASELINE_TAG)
        if r.returncode != 0:
            return False, f"Failed to create branch: {r.stderr}"

        tier_used = None
        git_error = ""

        # --- TIER 1: git apply ---
        normalized = normalize_diff(diff, file_path)
        with tempfile.NamedTemporaryFile(mode='w', suffix='.diff', delete=False, newline='\n') as tmp:
            tmp.write(normalized)
            tmp_path = tmp.name

        try:
            # Standard apply
            r = git("apply", "--ignore-space-change", "--ignore-whitespace",
                     "-p1", "--verbose", tmp_path)

            if r.returncode != 0:
                # Reduced context requirement
                r = git("apply", "--ignore-space-change", "--ignore-whitespace",
                        "-p1", "-C0", "--verbose", tmp_path)

            if r.returncode == 0:
                tier_used = "git-apply"
            else:
                git_error = r.stderr

        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        # --- TIER 2: Python snippet replacement ---
        if not tier_used and original_snippet and fixed_snippet:
            success, result = snippet_replace(file_path, original_snippet, fixed_snippet)
            if success:
                full_path = os.path.join(THEME_DIR, file_path)
                with open(full_path, 'w') as f:
                    f.write(result)
                tier_used = "snippet-replace"

        if not tier_used:
            # All tiers failed — cleanup
            git("checkout", original_branch or "main")
            git("branch", "-D", branch_name)
            error_msg = f"All patch strategies failed.\nGit apply: {git_error}"
            if not original_snippet:
                error_msg += "\nTip: originalSnippet/fixedSnippet not provided for fallback."
            return False, error_msg

        # Stage and commit
        git("add", "-A")
        commit_msg = f"[COREWATCH] {fix_id}: {title}"
        r = git("commit", "-m", commit_msg)
        if r.returncode != 0:
            git("checkout", original_branch or "main")
            git("branch", "-D", branch_name)
            return False, f"Commit failed: {r.stderr}"

        # Track the applied fix
        tracker = load_applied_fixes()
        tracker["fixes"].append({
            "id": fix_id,
            "title": title,
            "branch": branch_name,
            "filePath": file_path,
            "tier": tier_used,
            "appliedAt": subprocess.run(
                ["date", "-Iseconds"], capture_output=True, text=True
            ).stdout.strip()
        })
        save_applied_fixes(tracker)

        return True, {
            "message": f"Fix applied on branch '{branch_name}' via {tier_used}",
            "branch": branch_name,
            "file": file_path,
            "tier": tier_used
        }

    finally:
        # Always return to original branch
        git("checkout", original_branch or "main")
        # Pop stash if we stashed something
        git("stash", "pop")


def deploy_fixes():
    """
    Merge all applied fix branches into a deploy branch using 3-way merge.
    Each fix branch was created from the baseline, so Git can auto-resolve
    non-overlapping changes.
    """
    tracker = load_applied_fixes()
    fix_list = tracker.get("fixes", [])

    if not fix_list:
        return False, "No fixes have been applied yet."

    original_branch = get_current_branch()

    # Stash any uncommitted changes
    git("stash", "push", "-m", "auto-stash-before-deploy")

    try:
        # Create/reset deploy branch from baseline
        if branch_exists("deploy"):
            git("branch", "-D", "deploy")

        r = git("checkout", "-b", "deploy", BASELINE_TAG)
        if r.returncode != 0:
            return False, f"Failed to create deploy branch: {r.stderr}"

        merged = []
        conflicts = []

        for fix in fix_list:
            branch = fix["branch"]
            fix_id = fix["id"]

            if not branch_exists(branch):
                conflicts.append({"id": fix_id, "error": f"Branch '{branch}' not found"})
                continue

            r = git("merge", "--no-edit", branch)
            if r.returncode != 0:
                # Merge conflict
                conflict_files = git("diff", "--name-only", "--diff-filter=U")
                git("merge", "--abort")
                conflicts.append({
                    "id": fix_id,
                    "error": "Merge conflict",
                    "conflictFiles": conflict_files.stdout.strip().split('\n') if conflict_files.stdout.strip() else []
                })
            else:
                merged.append(fix_id)

        if conflicts:
            # Stay on deploy with partial merges for inspection
            return False, {
                "message": f"Deployed {len(merged)} fixes, {len(conflicts)} conflicts",
                "merged": merged,
                "conflicts": conflicts
            }

        return True, {
            "message": f"All {len(merged)} fixes deployed successfully",
            "merged": merged,
            "branch": "deploy"
        }

    except Exception as e:
        return False, f"Deploy error: {str(e)}"
    finally:
        # Do NOT switch back — stay on deploy so working tree is ready
        # Pop stash on deploy branch
        git("stash", "pop")


def get_status():
    """List all fix branches and their status."""
    tracker = load_applied_fixes()
    fix_list = tracker.get("fixes", [])

    branches = []
    for fix in fix_list:
        exists = branch_exists(fix["branch"])
        branches.append({
            "id": fix["id"],
            "title": fix["title"],
            "branch": fix["branch"],
            "filePath": fix["filePath"],
            "appliedAt": fix.get("appliedAt", ""),
            "branchExists": exists
        })

    # Check if deploy branch exists
    deploy_exists = branch_exists("deploy")

    return True, {
        "fixes": branches,
        "totalApplied": len(branches),
        "deployBranchExists": deploy_exists,
        "currentBranch": get_current_branch()
    }


def unapply_fix(fix_id):
    """Remove a fix branch and its tracking entry."""
    branch_name = f"fix/{fix_id}"

    current = get_current_branch()
    if current == branch_name:
        git("checkout", "main")

    if branch_exists(branch_name):
        git("branch", "-D", branch_name)

    tracker = load_applied_fixes()
    tracker["fixes"] = [f for f in tracker["fixes"] if f["id"] != fix_id]
    save_applied_fixes(tracker)

    return True, f"Fix '{fix_id}' removed"


if __name__ == "__main__":
    try:
        input_data = sys.stdin.read()
        if not input_data:
            print(json.dumps({"success": False, "error": "No input received"}))
            sys.exit(1)

        data = json.loads(input_data)
        action = data.get("action", "apply")

        if action == "apply":
            fix_id = data.get("fixId")
            title = data.get("title", "Optimization")
            diff = data.get("diff")
            file_path = data.get("filePath")
            original_snippet = data.get("originalSnippet")
            fixed_snippet = data.get("fixedSnippet")

            if not fix_id or not diff or not file_path:
                print(json.dumps({"success": False, "error": "Missing fixId, diff, or filePath"}))
                sys.exit(1)

            # Strip theme/ prefix if present
            if file_path.startswith("theme/"):
                file_path = file_path[len("theme/"):]

            success, result = apply_fix(fix_id, title, diff, file_path, original_snippet, fixed_snippet)

        elif action == "deploy":
            success, result = deploy_fixes()

        elif action == "status":
            success, result = get_status()

        elif action == "unapply":
            fix_id = data.get("fixId")
            if not fix_id:
                print(json.dumps({"success": False, "error": "Missing fixId"}))
                sys.exit(1)
            success, result = unapply_fix(fix_id)

        else:
            print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
            sys.exit(1)

        if isinstance(result, dict):
            print(json.dumps({"success": success, **result}))
        else:
            key = "message" if success else "error"
            print(json.dumps({"success": success, key: result}))

    except Exception as e:
        print(json.dumps({"success": False, "error": f"Internal Error: {str(e)}"}))
        sys.exit(1)