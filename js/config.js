// Waya Surf - Supabase Configuration
// REPLACE WITH YOUR PROJECT CREDENTIALS

const SUPABASE_URL = 'https://pufybvfmatewxivtcsyv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1ZnlidmZtYXRld3hpdnRjc3l2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njg1MTMwMDEsImV4cCI6MjA4NDA4OTAwMX0.tkSMldmRy69v2I3hIJaoK3jS2DnsoiXYIE0mf99QW74';

// Initialize Client
if (typeof supabase !== 'undefined' && typeof supabase.createClient === 'function') {
    window.supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
    // Bind to a global var that our scripts expect.
    // NOTE: This overwrites the 'supabase' library object with the client instance.
    window.supabase = window.supabaseClient;
    console.log('✅ Supabase Client Initialized');
} else if (typeof window.supabaseClient !== 'undefined') {
    // Already initialized logic
    window.supabase = window.supabaseClient;
} else {
    console.error('❌ Supabase Library NOT loaded. Check CDN connection.');
    // Alert the user via the UI if this runs
    window.addEventListener('DOMContentLoaded', () => {
        const status = document.createElement('div');
        status.innerText = '❌ Critical: Supabase JS not loaded';
        status.style.cssText = 'position:fixed;top:0;left:0;background:red;color:white;padding:1rem;z-index:9999;width:100%';
        document.body.appendChild(status);
    });
}
