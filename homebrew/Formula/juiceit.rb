class Juiceit < Formula
    desc "A script to rip DVDs using HandBrakeCLI"
    homepage "https://github.com/brian-slate/juice-it"
    url "https://github.com/yourusername/juice-it/releases/download/v1.0.9/juice-it-v1.0.9.tar.gz"
    sha256 "bec9f0cc5cf0acc76172ae4a72efc3750c01431d345b69e8be0c702a06c751c4"

    depends_on "node"
    depends_on "handbrake"
    depends_on "libdvdcss"

    def install
      # Install the entire package
      libexec.install Dir["*"]  # This installs everything in the current directory to libexec

      # Symlink the juiceit executable to the bin directory
      bin.install_symlink libexec/"juiceit.js" => "juiceit"
    end

    test do
      system "#{bin}/juiceit", "--help"
    end
  end