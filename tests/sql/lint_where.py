"""Supabase رافض أي DELETE أو UPDATE بلا WHERE (pg-safeupdate)، حتى داخل الدوال، وقاعدة replay المحلية لا ترفضه.
هذا الفحص يمسك الخطأ قبل النشر. الاستخدام: python3 tests/sql/lint_where.py (يرجع 1 إذا وجد شيئًا)."""
import glob, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
bad = []
for f in sorted(glob.glob(os.path.join(ROOT, "supabase", "*.sql"))):
    s = open(f, encoding="utf-8").read()
    # بلا تعليقات السطر، حتى لا تُحسب «where» في تعليق.
    code = re.sub(r"--[^\n]*", "", s)
    pattern = r"(?<![\w.])(delete\s+from\s+[^;]*;|update\s+(?!of\b)[\w.\"]+\s+(?:as\s+\w+\s+)?set\b[^;]*;)"
    for m in re.finditer(pattern, code, re.I | re.S):
        if not re.search(r"\bwhere\b", m.group(0), re.I):
            line = code[: m.start()].count("\n") + 1
            bad.append(f"{os.path.basename(f)}:{line}: {' '.join(m.group(0).split())[:120]}")
if bad:
    print("DELETE/UPDATE بلا WHERE (Supabase يرفضها):")
    print("\n".join(bad))
    sys.exit(1)
