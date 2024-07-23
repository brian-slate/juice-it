# Juice It

A script to rip DVDs using HandBrakeCLI.

## Features

- Easily rip DVDs to digital formats.
- Supports various encoding options.
- Caches DVD information for faster subsequent rips.

## Prerequisites

Before using this tool, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (version 12 or higher)
- [HandBrakeCLI](https://handbrake.fr/)
- [libdvdcss](https://www.videolan.org/developers/libdvdcss/)

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/yourusername/juice-it.git
   cd juice-it
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

3. (Optional) Install globally for easier access:

   ```bash
   npm install -g .
   ```

## Usage

To use the tool, run the following command:

```bash
juiceit --dvdSource /dev/disk5 --output ./output-directory
```

Replace `/dev/disk5` with the path to your DVD drive and `./output-directory` with your desired output directory.

## Creating a Release

To create a new release of the tool, follow these steps:

1. **Bump the Version and Create a Tarball**:
   Run the following command to bump the version, create a changelog, tag the release, and create a tarball:

   ```bash
   npm run release
   ```

   This command will:
   - Update the version in `package.json`.
   - Generate a `CHANGELOG.md` file.
   - Create a Git tag for the release.
   - Create a tarball named `juice-it-vX.Y.Z.tar.gz` (where `X.Y.Z` is the new version).

2. **Push Changes to GitHub**:
   After running the release command, push the changes and tags to your GitHub repository:

   ```bash
   git push --follow-tags
   ```

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please open an issue or submit a pull request for any improvements or bug fixes.

## Acknowledgments

- [HandBrake](https://handbrake.fr/) for the video transcoding library.
- [libdvdcss](https://www.videolan.org/developers/libdvdcss/) for DVD decryption support.