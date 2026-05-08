const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
    try {
        const baseUrl = 'https://azoramoon.com';
        const query = 'juju';
        const searchUrl = `${baseUrl}/series?searchTerm=${encodeURIComponent(query)}`;
        console.log('Searching:', searchUrl);
        
        const { data } = await axios.get(searchUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Referer': baseUrl
            }
        });
        
        const $ = cheerio.load(data);
        console.log('HTML Length:', data.length);
        
        // Check for common Madara or Azora selectors
        const containers = $('a.font-bold, a.group.flex, .c-tabs-item__content');
        console.log('Containers found:', containers.length);
        
        containers.each((i, el) => {
            console.log(`[${i}] Text:`, $(el).text().trim());
            console.log(`[${i}] Href:`, $(el).attr('href'));
        });

    } catch (err) {
        console.error('Error:', err.message);
    }
}

test();
