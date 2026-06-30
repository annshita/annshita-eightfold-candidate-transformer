const fs = require('fs');

// ==========================================
// 1. NORMALIZERS
// ==========================================

function normalizePhone(rawPhone) {
    if (!rawPhone) return null;
    const digits = rawPhone.replace(/\D/g, '');
    return digits.startsWith('91') ? `+${digits}` : `+91${digits}`;
}

function normalizeSkills(skillsArray) {
    if (!skillsArray || !Array.isArray(skillsArray)) return [];
    return skillsArray.map(s => s.toLowerCase().trim());
}

function normalizeDate(rawDate) {
    if (!rawDate) return null;
    // Basic handler for formats like "Jan 2020", "01/2020", "2020"
    const date = new Date(rawDate);
    if (isNaN(date.getTime())) return null; // Invalid date
    
    const year = date.getFullYear();
    let month = date.getMonth() + 1;
    month = month < 10 ? `0${month}` : month;
    
    return `${year}-${month}`;
}


// ==========================================
// 2. EXTRACTORS
// ==========================================

function extractATS(filePath) {
    try {
        const rawData = fs.readFileSync(filePath, 'utf-8');
        const data = JSON.parse(rawData);
        
        return {
            source: 'ATS_JSON',
            confidence: 0.9,
            profile: {
                full_name: data.candidate_name || null,
                emails: data.contact_email ? [data.contact_email] : [],
                phones: data.phone_num ? [normalizePhone(data.phone_num)] : [],
                location: data.address || null,
                years_experience: data.total_exp_years || null,
                skills: normalizeSkills(data.tech_stack),
                // Map ATS experience to canonical format
                experience: (data.work_history || []).map(job => ({
                    company: job.company_name,
                    title: job.job_title,
                    start: normalizeDate(job.start_date),
                    end: normalizeDate(job.end_date),
                    summary: job.description
                }))
            }
        };
    } catch (error) {
        console.error("Failed to read ATS file:", error.message);
        return null;
    }
}

async function extractGitHub(username) {
    try {
        const response = await fetch(`https://api.github.com/users/${username}`);
        const data = await response.json();
        
        return {
            source: 'GITHUB_API',
            confidence: 0.7,
            profile: {
                full_name: data.name || null,
                links: data.html_url ? [data.html_url] : [],
                headline: data.bio || null,
                location: data.location || null
            }
        };
    } catch (error) {
        console.error("Failed to fetch GitHub data:", error.message);
        return null;
    }
}


// ==========================================
// 3. MERGE ENGINE (Conflict Resolution)
// ==========================================

function mergeProfiles(extractedRecords) {
    // The complete canonical schema required by the PDF
    const canonicalProfile = {
        candidate_id: `cand_${Date.now()}`, // Generate a unique ID
        full_name: null,
        emails: [],
        phones: [],
        location: null,
        links: [],
        headline: null,
        years_experience: null,
        skills: [],
        experience: [],
        education: [],
        provenance: [],
        overall_confidence: 0 
    };

    const sortedRecords = extractedRecords.filter(r => r !== null).sort((a, b) => b.confidence - a.confidence);
    
    if (sortedRecords.length > 0) {
        canonicalProfile.overall_confidence = sortedRecords[0].confidence;
    }

    sortedRecords.forEach(record => {
        const { source, profile } = record;

        // 1. Merge standard single-value fields
        ['full_name', 'headline', 'location', 'years_experience'].forEach(field => {
            if (profile[field] && !canonicalProfile[field]) {
                canonicalProfile[field] = profile[field];
                canonicalProfile.provenance.push({ field, source, method: "highest_confidence" });
            }
        });

        // 2. Merge simple arrays (emails, phones, links, skills)
        ['emails', 'phones', 'links', 'skills'].forEach(field => {
            if (profile[field] && profile[field].length > 0) {
                profile[field].forEach(item => {
                    if (!canonicalProfile[field].includes(item)) {
                        canonicalProfile[field].push(item);
                        canonicalProfile.provenance.push({ field: `${field}[]`, source, method: "appended_unique" });
                    }
                });
            }
        });

        // 3. Merge complex object arrays (experience, education)
        ['experience', 'education'].forEach(field => {
             if (profile[field] && profile[field].length > 0) {
                 // In a production system, you'd deduplicate jobs based on company+date. 
                 // For this scope, appending is acceptable.
                 canonicalProfile[field] = [...canonicalProfile[field], ...profile[field]];
                 canonicalProfile.provenance.push({ field: `${field}[]`, source, method: "appended_objects" });
             }
        });
    });

    return canonicalProfile;
}


// ==========================================
// 4. PROJECTION (Runtime Config)
// ==========================================

function projectProfile(canonicalProfile, configPath) {
    const rawConfig = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(rawConfig);
    
    const finalOutput = {};

    config.fields.forEach(rule => {
        const sourcePath = rule.from || rule.path; 
        let value;
        
        if (sourcePath.includes('[0]')) {
            const arrayName = sourcePath.split('[')[0];
            value = canonicalProfile[arrayName] ? canonicalProfile[arrayName][0] : null;
        } else {
            value = canonicalProfile[sourcePath];
        }

        if (!value) {
            if (config.on_missing === 'null') finalOutput[rule.path] = null;
            if (config.on_missing === 'omit') return;
        } else {
            finalOutput[rule.path] = value;
        }
    });

    // Handle confidence toggle
    if (config.include_confidence) {
        finalOutput.overall_confidence = canonicalProfile.overall_confidence;
        finalOutput.provenance = canonicalProfile.provenance;
    }

    return finalOutput;
}


// ==========================================
// 5. CLI RUNNER
// ==========================================

async function main() {
    console.log("Starting Eightfold Candidate Transformer...\n");

    const atsRecord = extractATS('./ats.json');
    const githubRecord = await extractGitHub('octocat'); 

    const mergedProfile = mergeProfiles([atsRecord, githubRecord]);
    
    console.log("=== DEFAULT CANONICAL PROFILE ===");
    console.log(JSON.stringify(mergedProfile, null, 2));

    try {
        const customProfile = projectProfile(mergedProfile, './config.json');
        console.log("\n=== CUSTOM CONFIGURED PROFILE ===");
        console.log(JSON.stringify(customProfile, null, 2));
    } catch (e) {
         console.log("\n(No config.json found or invalid. Skipping projection phase.)");
    }
}

// Only run main() if executed directly from the terminal
if (require.main === module) {
    main();
}

module.exports = {
    normalizePhone,
    normalizeDate,
    mergeProfiles
};