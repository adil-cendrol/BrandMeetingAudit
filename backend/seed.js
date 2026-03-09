const FormData = require('form-data');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Create a test transcript file
const testContent = `BOARD MEETING TRANSCRIPT - Q4 2025 FULL BOARD STRATEGY REVIEW
Date: 15 December 2025
Organisation: Meridian Capital Group plc

[00:04:12] Chair (Sir David Okafor): The board reviewed the quarterly financial statements and noted a 12% variance in CAPEX expenditure against the approved budget.
[00:11:35] CFO (James Whitfield): Revenue projections for Q4 have been revised upward by 8% following strong performance in the APAC region.
[00:19:22] CEO (Amanda Chen): The M&A strategy paper was presented. The board unanimously agreed to proceed with preliminary due diligence on the target entity.
[00:27:48] Independent Director (Lord Anthony Graves): I raise a concern that the risk-adjusted scenario analysis was not included in the board pack for this item.
[00:33:01] Company Secretary (Robert Liu): Legal counsel has provided written confirmation that the proposed transaction complies with all applicable regulatory requirements.
[00:41:15] CRO (Dr. Priya Nair): The enterprise risk register has been updated to reflect three new tier-1 risks identified in the strategic planning session.
[00:48:30] Chair: Item 4 was approved with four votes in favour and no dissent registered from any independent director.
[00:55:44] NED – Audit Chair (Caroline Mwangi): The external audit findings were tabled. Management has addressed 6 of 9 recommendations from the prior period.
[01:02:17] CEO: ESG reporting framework will be aligned with GRI standards from the next reporting cycle.
[01:08:55] CFO: No stress testing or downside scenario modelling was conducted for the proposed capital allocation item.`;

const tmpFile = path.join(__dirname, 'test_transcript.txt');
fs.writeFileSync(tmpFile, testContent);

const form = new FormData();
form.append('meetingName', 'Q4 2025 Full Board Strategy Review');
form.append('meetingDate', '2025-12-15');
form.append('files', fs.createReadStream(tmpFile), { filename: 'board_transcript.txt', contentType: 'text/plain' });

const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/assessments',
    method: 'POST',
    headers: form.getHeaders(),
};

const req = http.request(options, (res) => {
    let data = '';
    res.on('data', d => data += d);
    res.on('end', () => {
        const parsed = JSON.parse(data);
        console.log('Created assessment ID:', parsed.data?.id);

        // Start analysis
        const startOptions = {
            hostname: 'localhost', port: 5000,
            path: `/api/assessments/${parsed.data.id}/start`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
        };

        const req2 = http.request(startOptions, (res2) => {
            let d2 = '';
            res2.on('data', c => d2 += c);
            res2.on('end', () => {
                console.log('Started analysis:', JSON.parse(d2).message);
                console.log(`Visit: http://localhost:5173/processing/${parsed.data.id}`);
            });
        });
        req2.end();
    });
});

form.pipe(req);
req.on('error', console.error);
