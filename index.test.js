const { normalizePhone, mergeProfiles } = require('./index');

describe('Data Normalizers', () => {
    
    test('normalizePhone should convert raw strings to E.164 format with +91', () => {
        // Test 1: Standard Indian format (10 digits)
        expect(normalizePhone('98765-43210')).toBe('+919876543210');
        
        // Test 2: Random characters and spaces
        expect(normalizePhone('98765.43210 ext 9')).toBe('+9198765432109');
        
        // Test 3: Null/Empty handling
        expect(normalizePhone(null)).toBeNull();
    });

});

describe('Merge Engine (Conflict Resolution)', () => {
    
    test('mergeProfiles should prioritize the source with the highest confidence', () => {
        
        
        const lowConfidenceRecord = {
            source: 'GITHUB',
            confidence: 0.5,
            profile: {
                full_name: 'Aarav', // Incomplete name
                emails: ['github_test@example.com']
            }
        };

        
        const highConfidenceRecord = {
            source: 'ATS',
            confidence: 0.9,
            profile: {
                full_name: 'Aarav Sharma', // Better name
                emails: ['professional@example.com']
            }
        };

        // Run the merge engine
        const result = mergeProfiles([lowConfidenceRecord, highConfidenceRecord]);

        expect(result.full_name).toBe('Aarav Sharma');

       
        expect(result.emails).toContain('professional@example.com');
        expect(result.emails).toContain('github_test@example.com');
        
    
        const nameProvenance = result.provenance.find(p => p.field === 'full_name');
        expect(nameProvenance.source).toBe('ATS');
    });
});