class Juiceit < Formula
  desc "Smart DVD ripper with automatic metadata lookup and episode naming"
  homepage "https://github.com/brian-slate/juice-it"
  url "file:///Users/brianslate/code/personal/juice-it", using: :git, branch: "improve-output-ui"
  version "1.0.11-dev"
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

  def caveats
    <<~EOS
      🎬 JuiceIt installed successfully!
      
      📋 Next Steps:
      1. Get a free TMDB API key:
         https://www.themoviedb.org/settings/api
      
      2. Run setup:
         juiceit --setup
      
      3. Insert a DVD and run:
         juiceit
      
      For help: juiceit --help
    EOS
  end

  test do
    system "#{bin}/juiceit", "--help"
  end
end
