module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    moduleNameMapper: {
        '^vscode$': '<rootDir>/src/__mocks__/vscode.ts',
    },
    testMatch: [
        '**/test/suite/**/*.test.ts'
    ],
    modulePathIgnorePatterns: [
        '<rootDir>/out/'
    ]
};
