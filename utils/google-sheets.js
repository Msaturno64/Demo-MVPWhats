const { google } = require('googleapis');
// Initializes the Google APIs client library and sets up the authentication using service account credentials.
const auth = new google.auth.GoogleAuth({
    keyFile: './google.json',  // Path to your service account key file.
    scopes: ['https://www.googleapis.com/auth/spreadsheets']  // Scope for Google Sheets API.
});

const spreadsheetId = '1C2uLgeXSsbDRYRj8y--JALWcvLA260wbxajtIdvBDuo';

async function appendToSheet(values) {
    const sheets = google.sheets({ version: 'v4', auth }); // Create a Sheets API client instance
    const range = 'A2'; // The range in the sheet to start appending
    const valueInputOption = 'USER_ENTERED'; // How input data should be interpreted

    const resource = { values: values };

    try {
        const res = await sheets.spreadsheets.values.append({
            spreadsheetId,
            range,
            valueInputOption,
            resource,
        });
        return res; // Returns the response from the Sheets API
    } catch (error) {
        console.error('error', error); // Logs errors
    }
}

module.exports = { appendToSheet };
