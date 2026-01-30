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
    # Install all files to libexec first
    libexec.install Dir["*"]
    
    # Install npm dependencies in libexec
    system "npm", "install", "--production", "--prefix", libexec
    
    # Create wrapper script that uses node
    (bin/"juiceit").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/juiceit.js" "$@"
    EOS
  end

  test do
    system "#{bin}/juiceit", "--help"
  end
end
