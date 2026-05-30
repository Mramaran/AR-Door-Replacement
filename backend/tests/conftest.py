"""Spin up the visualiser Flask app in a background thread for WS tests."""
import os
import sys
import threading
import time

import pytest

# Make the visualiser package importable when running pytest from anywhere
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, HERE)
os.chdir(HERE)  # app.py uses os.getcwd() for model paths


@pytest.fixture(scope="session")
def live_server():
    import app as visualiser_app

    server = visualiser_app.app

    def _run():
        # use_reloader=False is critical — otherwise it forks
        server.run(host="127.0.0.1", port=5050, debug=False, use_reloader=False, threaded=True)

    t = threading.Thread(target=_run, daemon=True)
    t.start()

    # wait for the server to come up
    import urllib.request
    for _ in range(30):
        try:
            urllib.request.urlopen("http://127.0.0.1:5050/", timeout=1).read()
            break
        except Exception:
            time.sleep(0.5)
    else:
        raise RuntimeError("live_server never came up on port 5050")

    yield "ws://127.0.0.1:5050/ws/detect-stream"
