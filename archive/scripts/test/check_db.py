import os
import sys

# Add current directory to path so we can import config
sys.path.append(os.getcwd())

try:
    from srcs.config import Config
    print("Configuration loaded.")
    print(f"Host: {Config.FDALabel_HOST}")
    print(f"Port: {Config.FDALabel_PORT}")
    print(f"Service: {Config.FDALabel_SERVICE}")
    print(f"User: {Config.FDALabel_USER}")
    print(f"Password set? {{'Yes' if Config.FDALabel_PASSWORD else 'No'}}")
except ImportError as e:
    print(f"Error loading config: {e}")
    sys.exit(1)

try:
    import oracledb
    print("oracledb module imported successfully.")
except ImportError:
    print("Error: oracledb module NOT found. Please run 'pip install oracledb'.")
    sys.exit(1)

def test_connection():
    print("\nAttempting connection...")
    if not Config.FDALabel_PASSWORD:
        print("Skipping connection test: No password provided in FDALabel_PASSWORD env var.")
        return

    dsn = f"{Config.FDALabel_HOST}:{Config.FDALabel_PORT}/{Config.FDALabel_SERVICE}"
    try:
        conn = oracledb.connect(
            user=Config.FDALabel_USER,
            password=Config.FDALabel_PASSWORD,
            dsn=dsn
        )
        print("✅ Connection SUCCESSFUL!")
        conn.close()
    except Exception as e:
        print(f"❌ Connection FAILED: {e}")

if __name__ == "__main__":
    test_connection()