import urllib.request

try:
    url = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=5) as response:
        content = response.read()
        print(f"Successfully fetched html2pdf. Length: {len(content)} bytes")
        with open('assets/html2pdf.bundle.min.js', 'wb') as f_out:
            f_out.write(content)
        print("Saved to assets/html2pdf.bundle.min.js!")
except Exception as e:
    print("Fetch error:", e)

