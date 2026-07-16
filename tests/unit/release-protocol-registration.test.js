'use strict';

const pkg = require('../../package.json');
const { STUDY_SCHEME } = require('../../shared/study-deep-link');

describe('study protocol packaging contract', () => {
    it('registers the parser scheme exactly once as a Viewer', () => {
        const protocols = pkg.build && pkg.build.protocols;
        expect(Array.isArray(protocols)).toBe(true);

        const registrations = protocols.filter((entry) => entry.schemes.includes(STUDY_SCHEME));
        expect(registrations).toEqual([
            {
                name: 'Scrutinizer Study Link',
                schemes: ['scrutinizer'],
                role: 'Viewer'
            }
        ]);
    });
});
