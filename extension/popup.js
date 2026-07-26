const BACKEND_URL = "http://localhost:8000";

document.getElementById('generateBtn').addEventListener('click', async () => {
  const statusDiv = document.getElementById('status');
  statusDiv.innerText = "Generating note via Gemini... Please wait.";
  
  try {
    const res = await fetch(`${BACKEND_URL}/api/generate-daily-note`, {
      method: 'POST'
    });
    const data = await res.json();
    if (data.status === 'success') {
      statusDiv.innerText = `Success!\nSaved to: ${data.filepath}`;
    } else {
      statusDiv.innerText = `Error generating note.`;
    }
  } catch (err) {
    statusDiv.innerText = `Failed to connect to backend.\nIs the Python server running?`;
    console.error(err);
  }
});
