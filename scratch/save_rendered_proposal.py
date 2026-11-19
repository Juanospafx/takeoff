with open('scratch/run_edge.py', 'r', encoding='utf-8') as f:
    pass

import subprocess

cmd = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "--headless",
    "--disable-gpu",
    "--dump-dom",
    "http://localhost/takeoff/pages/project_dashboard.php?id=9&tab=proposal"
]
res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
stdout = res.stdout

idx1 = stdout.find('id="proposalDocument"')
idx2 = stdout.find('</main>', idx1)
proposal_doc_html = stdout[idx1:idx2]

print("proposalDocument HTML length:", len(proposal_doc_html))
with open('scratch/proposal_doc_rendered.html', 'w', encoding='utf-8') as f:
    f.write(proposal_doc_html)
print("Saved to scratch/proposal_doc_rendered.html")

