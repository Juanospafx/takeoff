import subprocess
import json

cmd = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "--headless",
    "--disable-gpu",
    "--virtual-time-budget=3000",
    "--dump-dom",
    "http://localhost/takeoff/scratch/test_page.html"
]

res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
stdout = res.stdout

idx = stdout.find('id="TEST_RESULTS">')
if idx != -1:
    idx2 = stdout.find('</div>', idx)
    data_str = stdout[idx + len('id="TEST_RESULTS">'):idx2]
    try:
        data = json.loads(data_str)
        print("=== TEST RESULTS ===")
        print(json.dumps(data, indent=2))
    except Exception as e:
        print("JSON parse error:", e)
        print("Raw:", data_str[:500])
else:
    print("TEST_RESULTS not found in DOM.")
    if "Error" in res.stderr:
        print("Stderr:", res.stderr)

