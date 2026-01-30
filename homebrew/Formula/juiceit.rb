class Juiceit < Formula
  desc "Smart DVD ripper with automatic metadata lookup and episode naming"
  homepage "https://github.com/brian-slate/juice-it"
  url "https://github.com/brian-slate/juice-it/releases/download/v1.0.11/juice-it-v1.0.11.tar.gz"
  sha256 "0cbf1ce078f126894b7ec3d254ba644de0dd3a1a915f97adb48c011eeaaedcde"
  license "MIT"

  depends_on "node"
  depends_on "handbrake"
  depends_on "libdvdcss"
  depends_on "ffmpeg"  # For ffprobe to check video durations

  def install
    # Install npm dependencies
    system "npm", "install", "--production", "--ignore-scripts"
    
    # Install all files to libexec
    libexec.install Dir["*"]
    
    # Symlink the executable
    bin.install_symlink libexec/"bin/juiceit"
  end

  test do
    system "#{bin}/juiceit", "--help"
  end
end
