import os
import requests
import sys
import argparse
from urllib.parse import urljoin

class DailyMedDownloader:
    BASE_URL = "https://dailymed-data.nlm.nih.gov/public-release-files/"
    
    # Pre-defined file structures based on DailyMed patterns
    FILES = {
        'prescription': [f"dm_spl_release_human_rx_part{i}.zip" for i in range(1, 7)],
        'otc': [f"dm_spl_release_human_otc_part{i}.zip" for i in range(1, 12)]
    }

    def __init__(self, output_dir="data/downloads/dailymed"):
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    def download_file(self, filename):
        url = urljoin(self.BASE_URL, filename)
        target_path = os.path.join(self.output_dir, filename)

        if os.path.exists(target_path):
            print(f"Skipping {filename}: Already exists.")
            return True

        print(f"Connecting to {url}...")
        try:
            with requests.get(url, stream=True, timeout=30) as r:
                r.raise_for_status()
                total_size = int(r.headers.get('content-length', 0))
                
                with open(target_path, 'wb') as f:
                    downloaded = 0
                    for chunk in r.iter_content(chunk_size=1024 * 1024): # 1MB chunks
                        if chunk:
                            f.write(chunk)
                            downloaded += len(chunk)
                            self.show_progress(downloaded, total_size, filename)
            print(f"\nSuccessfully downloaded {filename}")
            return True
        except Exception as e:
            print(f"\nError downloading {filename}: {e}")
            if os.path.exists(target_path):
                os.remove(target_path)
            return False

    def show_progress(self, current, total, filename):
        bar_length = 40
        if total <= 0:
            # Fallback if content-length is missing
            sys.stdout.write(f"\rDownloading {filename}: {current / (1024*1024):.1f} MB received...")
        else:
            fraction = current / total
            filled_length = int(bar_length * fraction)
            bar = '█' * filled_length + '-' * (bar_length - filled_length)
            percent = fraction * 100
            
            curr_mb = current / (1024 * 1024)
            total_mb = total / (1024 * 1024)
            
            # Clear line and print
            sys.stdout.write(f"\r{filename} |{bar}| {percent:.1f}% ({curr_mb:.1f}/{total_mb:.1f} MB)")
        
        sys.stdout.flush()

    def run(self, category):
        files_to_download = []
        if category == 'all':
            for cat in self.FILES:
                files_to_download.extend(self.FILES[cat])
        elif category in self.FILES:
            files_to_download = self.FILES[category]
        else:
            # Treat as custom filename if not a category
            files_to_download = [category]

        print(f"Queueing {len(files_to_download)} downloads...")
        for fname in files_to_download:
            self.download_file(fname)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Download bulk SPL ZIPs from DailyMed.")
    parser.add_argument("--category", choices=['prescription', 'otc', 'all'], default='all', 
                        help="Which set of files to download (default: all)")
    parser.add_argument("--out", default="data/downloads/dailymed", help="Output directory")
    
    args = parser.parse_args()
    
    downloader = DailyMedDownloader(output_dir=args.out)
    downloader.run(args.category)
