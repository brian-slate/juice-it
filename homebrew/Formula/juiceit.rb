class Juiceit < Formula
    desc "A script to rip DVDs using HandBrakeCLI"
    homepage "https://github.com/brian-slate/juice-it"
    url "https://github.com/brian-slate/juice-it/releases/download/v1.0.11/juice-it-v1.0.11.tar.gz"
    sha256 "0cbf1ce078f126894b7ec3d254ba644de0dd3a1a915f97adb48c011eeaaedcde"

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