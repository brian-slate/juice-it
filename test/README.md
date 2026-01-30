# JuiceIt Test Suite

This directory contains automated tests for JuiceIt.

## Running Tests

```bash
node test/juiceit.test.js
```

Or if npm scripts are configured:
```bash
npm test
```

## Test Coverage

### API Key Management
- ✅ Config file loading with non-existent config
- ✅ Config file creation with proper permissions (0600)
- ✅ Demo key warning functionality

### Helper Functions
- ✅ File size formatting (bytes, KB, MB, GB)
- ✅ Warning thresholds (< 50MB or < 5 minutes)

### Mock File Creation
- ✅ Create mock MP4 files with various sizes
- ✅ Verify file sizes match expectations

### Track Mapping
- ✅ Proposed mappings structure validation
- ✅ Track reassignment logic (mark as skip, reassign episodes)
- ✅ Finalization and rename operations

## Test Implementation

The tests use:
- Node.js built-in `assert` module for assertions
- Mock MP4 files with minimal headers for ffprobe compatibility
- Isolated test directories (`test/test-output/`) that are cleaned up after each test
- Simulated config files and directory structures

## Test Files Created

During test execution, temporary files are created in `test/test-output/`:
- `config/` - Mock config directory
- `output/` - Mock output directory with test MP4 files

These are automatically cleaned up after tests complete.

## Future Improvements

- Add integration tests with actual HandBrakeCLI (requires DVD drive or ISO)
- Mock TMDB API responses for metadata lookup tests
- Add edge case tests for malformed config files
- Test interactive UI components (requires terminal emulation)
