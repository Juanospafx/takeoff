import subprocess

cmd = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "--headless",
    "--disable-gpu",
    "--enable-logging",
    "--dump-dom",
    "http://localhost/takeoff/pages/project_dashboard.php?id=9&tab=proposal"
]

res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
print("Stdout length:", len(res.stdout))
print("Stderr length:", len(res.stderr))
if res.stderr:
    print("Stderr snippet:", res.stderr[:500])

idx = res.stdout.find('id="proposalDocument"')
if idx != -1:
    print("Found proposalDocument:")
    print(res.stdout[idx-20:idx+300])
else:
    print("proposalDocument not found in stdout")

