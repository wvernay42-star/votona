#!/usr/bin/env python3
"""Signale à IndexNow (Bing, Yandex, Seznam, Naver...) les pages de votona.fr
qui viennent de changer, pour qu'elles soient réindexées sans attendre.

Lancé par .github/workflows/indexnow.yml après chaque push sur main.

Usage :
  python3 scripts/indexnow.py --changed <sha_avant> <sha_apres>   pages modifiées entre deux commits
  python3 scripts/indexnow.py --all                               toutes les URL du sitemap
  ... --dry-run                                                   affiche sans envoyer

La clé IndexNow est le nom du fichier <clé>.txt à la racine du dépôt (publique
par conception : elle prouve seulement que le site nous appartient).
"""
import glob, json, os, re, subprocess, sys, urllib.request

HOST = "votona.fr"
SITE = "https://" + HOST
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
ENDPOINT = "https://api.indexnow.org/indexnow"


def find_key():
    for path in glob.glob(os.path.join(ROOT, "*.txt")):
        name = os.path.basename(path)[:-4]
        if re.fullmatch(r"[0-9a-f]{32}", name) and open(path).read().strip() == name:
            return name
    sys.exit("Clé IndexNow introuvable (fichier <clé>.txt à la racine).")


def url_for(path):
    """Fichier du dépôt -> URL publique, ou None si ce n'est pas une page."""
    if path == "index.html":
        return SITE + "/"
    m = re.fullmatch(r"candidats/(?:([a-z0-9-]+)/)?index\.html", path)
    if m:
        return SITE + "/candidats/" + (m.group(1) + "/" if m.group(1) else "")
    return None


def changed_urls(before, after):
    if not before or set(before) == {"0"}:  # premier push d'une branche
        return all_urls()
    out = subprocess.run(["git", "diff", "--name-only", before, after],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    urls = {url_for(p) for p in out.split()}
    if "sitemap.xml" in out.split():  # nouvelle page candidat : le sitemap change aussi
        urls.add(SITE + "/sitemap.xml")
    return sorted(u for u in urls if u)


def all_urls():
    xml = open(os.path.join(ROOT, "sitemap.xml"), encoding="utf-8").read()
    return re.findall(r"<loc>\s*(\S+?)\s*</loc>", xml)


def main(argv):
    dry = "--dry-run" in argv
    argv = [a for a in argv if a != "--dry-run"]
    if argv[:1] == ["--all"]:
        urls = all_urls()
    elif argv[:1] == ["--changed"] and len(argv) == 3:
        urls = changed_urls(argv[1], argv[2])
    else:
        sys.exit(__doc__)
    if not urls:
        print("Aucune page modifiée : rien à signaler.")
        return
    key = find_key()
    body = {"host": HOST, "key": key, "keyLocation": f"{SITE}/{key}.txt", "urlList": urls}
    print(f"{len(urls)} URL à signaler :", *urls, sep="\n  ")
    if dry:
        print("(essai à blanc, rien envoyé)")
        return
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json; charset=utf-8"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print("IndexNow a répondu", r.status)  # 200 ou 202 = reçu
    except urllib.error.HTTPError as e:
        # 403 = clé pas encore en ligne / invalide ; 422 = URL hors du domaine ; 429 = trop de requêtes
        sys.exit(f"IndexNow a refusé : HTTP {e.code} {e.read().decode(errors='replace')[:300]}")


if __name__ == "__main__":
    main(sys.argv[1:])
