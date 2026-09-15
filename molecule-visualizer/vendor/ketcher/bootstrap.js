/* Transport wrapper only; the unmodified Ketcher release is decompressed in memory. */
(async()=>{
  try{
    const chunks=await Promise.all(Array.from({length:5},async(_,i)=>{const response=await fetch(`./static/js/main.js.gz.part${i}`);if(!response.ok)throw Error('Ketcher asset '+response.status);return response.arrayBuffer();}));
    const stream=new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'));
    const script=document.createElement('script');script.textContent=await new Response(stream).text();document.head.appendChild(script);
  }catch(error){document.getElementById('root').textContent='Ketcherを起動できませんでした。最新のChrome / Edge / Firefox / Safariで再読み込みしてください。 '+error.message;}
})();
