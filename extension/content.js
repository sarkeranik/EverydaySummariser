// Extract text and image URLs from the page

function capturePageData() {
  const url = window.location.href;
  const title = document.title;
  
  // Get visible text (simple approach: innerText of body)
  // Clean up excessive whitespace and newlines
  let content = document.body.innerText || "";
  content = content.replace(/\s+/g, ' ').trim();
  
  // Get image URLs
  const imgElements = document.querySelectorAll('img');
  const images = [];
  imgElements.forEach(img => {
    if (img.src && img.src.startsWith('http')) {
      images.push({
        url: url,
        image_url: img.src,
        alt_text: img.alt || ""
      });
    }
  });
  
  // Send to background script
  chrome.runtime.sendMessage({
    type: 'PAGE_DATA',
    payload: {
      textData: {
        url: url,
        title: title,
        content: content
      },
      imageData: images
    }
  });
}

// Run after a short delay to allow dynamic content to load
setTimeout(capturePageData, 3000);
