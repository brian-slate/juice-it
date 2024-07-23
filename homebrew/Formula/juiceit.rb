class Juiceit < Formula
    desc "A script to rip DVDs using HandBrakeCLI"
    homepage "https://github.com/brian-slate/juice-it"
    url "https://github.com/brian-slate/juice-it/releases/download/v1.0.10/juice-it-v1.0.10.tar.gz"
    sha256 "de5f9bc0f3804ab8edcc3f18851fc298d2137a7e333490cf301a743924c59072"

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