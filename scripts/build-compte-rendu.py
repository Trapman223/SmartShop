#!/usr/bin/env python3
"""
Smart-Shop — génère un HTML imprimable à partir du compte-rendu Markdown.

Aucune dépendance : ni pandoc, ni npm, ni pip. Le Markdown du compte-rendu
n'utilise qu'un sous-ensemble connu (titres, tableaux, blocs de code, listes,
citations, règles horizontales, emphase et code en ligne), que ce script
couvre entièrement.

Usage :
    python3 scripts/build-compte-rendu.py
    # puis ouvrir le HTML et imprimer en PDF (Cmd+P → Enregistrer au format PDF)
"""

import base64
import glob
import html
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(RACINE, 'docs', 'compte-rendu', 'compte-rendu.md')
CIBLE = os.path.join(RACINE, 'docs', 'compte-rendu', 'compte-rendu.html')

DOSSIER_CAPTURES = os.path.join(RACINE, 'docs', 'compte-rendu', 'captures')


def captures_pour(numero):
    """Fichiers image correspondant à une capture, encodés en data URI.

    Convention de nommage : « capture 7.png » pour une image unique,
    « capture 8-1.png » et « capture 8-2.png » lorsque la capture en demande
    plusieurs. Les images sont embarquées en base64 pour que le HTML — et
    donc le PDF produit à partir de lui — soit autonome.
    """
    motifs = [f'capture {numero}.png', f'capture {numero}-*.png']
    fichiers = []
    for motif in motifs:
        fichiers.extend(sorted(glob.glob(os.path.join(DOSSIER_CAPTURES, motif))))

    images = []
    for chemin in fichiers:
        with open(chemin, 'rb') as f:
            donnees = base64.b64encode(f.read()).decode('ascii')
        images.append(f'data:image/png;base64,{donnees}')
    return images


CSS = """
@page { size: A4; margin: 14mm 14mm; }
:root {
  --encre: #1a1d23; --doux: #5a6270; --trait: #d8dce3;
  --fond-code: #f6f7f9; --accent: #1f4e79;
}
* { box-sizing: border-box; }
body {
  font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
  color: var(--encre); line-height: 1.45; font-size: 10.2pt;
  max-width: 100%; margin: 0; padding: 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
h1 { font-size: 17pt; color: var(--accent); margin: 0 0 .3em; line-height: 1.2; }
h2 {
  font-size: 12.5pt; color: var(--accent); margin: 1.1em 0 .4em;
  padding-bottom: .25em; border-bottom: 2px solid var(--trait);
  page-break-after: avoid;
}
h3 { font-size: 10.8pt; margin: .9em 0 .3em; page-break-after: avoid; }
h4 { font-size: 11pt; margin: 1.1em 0 .35em; color: var(--doux); page-break-after: avoid; }
p { margin: .45em 0; }
strong { font-weight: 650; }
hr { border: none; border-top: 1px solid var(--trait); margin: 1em 0; }
a { color: var(--accent); }

table {
  border-collapse: collapse; width: 100%; margin: 1em 0;
  font-size: 9pt; page-break-inside: avoid;
}
th, td { border: 1px solid var(--trait); padding: .28em .45em; text-align: left; vertical-align: top; }
th { background: #eef1f5; font-weight: 650; }
tr:nth-child(even) td { background: #fafbfc; }

pre {
  background: var(--fond-code); border: 1px solid var(--trait);
  border-radius: 4px; padding: .5em .7em; overflow-x: auto;
  font-size: 7.7pt; line-height: 1.34; page-break-inside: avoid;
  font-family: "SF Mono", Menlo, Consolas, monospace;
  white-space: pre;
}
code {
  font-family: "SF Mono", Menlo, Consolas, monospace;
  font-size: .88em; background: var(--fond-code);
  padding: .1em .32em; border-radius: 3px;
}
pre code { background: none; padding: 0; font-size: inherit; }

blockquote {
  margin: 1em 0; padding: .6em 1em; border-left: 3px solid var(--accent);
  background: #f4f7fa; color: #2c3440; page-break-inside: avoid;
}
blockquote p { margin: .3em 0; }

/* ---- Fiches « capture à insérer » ------------------------------------- */
.capture {
  margin: .9em 0; border: 1.2px solid var(--accent); border-radius: 4px;
  padding: 0;
  page-break-inside: avoid; break-inside: avoid; overflow: hidden;
}
.capture-titre {
  background: var(--accent); color: #fff; padding: .45em .9em;
  display: flex; align-items: baseline; gap: .8em;
}
.capture-num {
  font-weight: 700; font-size: 9.5pt; letter-spacing: .06em;
  border: 1px solid rgba(255,255,255,.55); border-radius: 3px;
  padding: .1em .5em; white-space: nowrap;
}
.capture-sujet { font-size: 10.5pt; font-weight: 600; }
.capture-corps { padding: .55em .8em .15em; background: #fbfcfd; font-size: 9pt; }
.capture-corps p { margin: .35em 0; }
.capture-corps pre { margin: .5em 0; font-size: 8.8pt; }
.capture-corps strong { color: var(--accent); }
.capture-zone {
  margin: .5em .8em .8em; height: 48mm;
  border: 2px dashed #b4bdc9; border-radius: 4px; background: #fafbfc;
  display: flex; align-items: center; justify-content: center;
}
.capture-img {
  display: block; width: calc(100% - 1.6em); margin: .5em .8em;
  /* Plafond de hauteur : sans lui, une capture carrée occuperait 120 mm et
     ferait exploser la pagination. */
  max-height: 92mm; object-fit: contain; object-position: left top;
  border: 1px solid #ccd3dc; border-radius: 3px;
}
.capture-legende {
  margin: .3em .9em .8em; padding-top: .4em;
  border-top: 1px solid #e4e8ee;
  font-size: 8.6pt; color: var(--doux); font-style: italic;
}
.capture-zone span {
  color: #97a1b0; font-size: 10pt; font-style: italic; letter-spacing: .02em;
}

ul, ol { margin: .45em 0; padding-left: 1.4em; }
li { margin: .18em 0; }

@media print {
  body { padding: 0; max-width: none; }
  /* Pas de saut de page par section : le document enchaînerait
     21 pages pour 21 titres, quel que soit le volume de texte. */
  h2:first-of-type { page-break-before: avoid; }
}
"""


def en_ligne(texte):
    """Emphase, code en ligne et liens — le code en ligne est protégé d'abord."""
    jetons = []

    def garder(m):
        jetons.append('<code>%s</code>' % html.escape(m.group(1)))
        return '\x00%d\x00' % (len(jetons) - 1)

    texte = re.sub(r'`([^`]+)`', garder, texte)
    texte = html.escape(texte)
    texte = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<a href="\2">\1</a>', texte)
    texte = re.sub(r'\*\*([^*]+)\*\*', r'<strong>\1</strong>', texte)
    texte = re.sub(r'(?<![\w*])\*([^*\n]+)\*(?![\w*])', r'<em>\1</em>', texte)
    texte = re.sub(r'(?<![\w_])_([^_\n]+)_(?![\w_])', r'<em>\1</em>', texte)
    return re.sub(r'\x00(\d+)\x00', lambda m: jetons[int(m.group(1))], texte)


def ligne_tableau(ligne):
    cellules = [c.strip() for c in ligne.strip().strip('|').split('|')]
    return cellules


def convertir(md):
    lignes = md.split('\n')
    sortie = []
    i = 0
    n = len(lignes)

    while i < n:
        ligne = lignes[i]

        # Bloc de code clôturé
        if ligne.startswith('```'):
            i += 1
            bloc = []
            while i < n and not lignes[i].startswith('```'):
                bloc.append(lignes[i])
                i += 1
            i += 1
            sortie.append('<pre><code>%s</code></pre>' % html.escape('\n'.join(bloc)))
            continue

        # Règle horizontale
        if re.fullmatch(r'-{3,}', ligne.strip()):
            sortie.append('<hr />')
            i += 1
            continue

        # Titre
        m = re.match(r'^(#{1,6})\s+(.*)$', ligne)
        if m:
            niveau = len(m.group(1))
            sortie.append('<h%d>%s</h%d>' % (niveau, en_ligne(m.group(2)), niveau))
            i += 1
            continue

        # Tableau : une ligne d'en-tête suivie d'un séparateur
        if (ligne.strip().startswith('|') and i + 1 < n
                and re.fullmatch(r'\|[\s:|-]+\|', lignes[i + 1].strip())):
            entetes = ligne_tableau(ligne)
            i += 2
            corps = []
            while i < n and lignes[i].strip().startswith('|'):
                corps.append(ligne_tableau(lignes[i]))
                i += 1
            html_tab = ['<table><thead><tr>']
            html_tab += ['<th>%s</th>' % en_ligne(c) for c in entetes]
            html_tab.append('</tr></thead><tbody>')
            for rangee in corps:
                html_tab.append('<tr>')
                html_tab += ['<td>%s</td>' % en_ligne(c) for c in rangee]
                html_tab.append('</tr>')
            html_tab.append('</tbody></table>')
            sortie.append(''.join(html_tab))
            continue

        # Citation
        if ligne.startswith('>'):
            bloc = []
            while i < n and lignes[i].startswith('>'):
                # Retirer le « > » et UN seul espace : l'indentation des blocs
                # de code imbriqués doit être préservée.
                brute = lignes[i][1:]
                bloc.append(brute[1:] if brute.startswith(' ') else brute)
                i += 1
            interne = '\n'.join(bloc)

            # Un encadré de capture est reconnu à son titre. Il est rendu comme
            # une fiche dédiée, avec un cadre vide réservé à la capture.
            m_cap = re.match(r'\s*#{1,6}\s*\[CAPTURE À INSÉRER[^\]]*\]',
                             interne)
            if m_cap is not None:
                titre = m_cap.group(0).lstrip('# ').strip()
                num = re.search(r'n°\s*(\d+)', titre)
                numero = num.group(1) if num else '?'
                sujet = re.sub(r'^\[CAPTURE À INSÉRER\s*—?\s*n°\s*\d+\s*:?\s*',
                               '', titre).rstrip(']').strip()
                brut = interne[m_cap.end():].lstrip('\n')
                images = captures_pour(numero)

                if images:
                    # Capture disponible : la fiche devient une figure. On
                    # conserve la commande (reproductibilité) et la portée de
                    # la preuve, mais « Doit être visible » devient redondant —
                    # l'image le montre.
                    brut = re.sub(
                        r'\*\*Doit être visible\s*:\*\*.*?(?=\n\*\*|\Z)',
                        '', brut, flags=re.S)
                    legende = ''
                    m_leg = re.search(
                        r'\*\*(?:Démontre|Ce que la capture démontre)\s*:\*\*\s*(.*?)\Z',
                        brut, flags=re.S)
                    if m_leg is not None:
                        legende = en_ligne(' '.join(m_leg.group(1).split()))
                        brut = brut[:m_leg.start()]
                    corps = convertir(brut.strip())
                    visuel = ''.join(
                        '<img class="capture-img" src="%s" alt="Capture %s" />' % (src, numero)
                        for src in images
                    )
                    bas = ('<p class="capture-legende">%s</p>' % legende) if legende else ''
                else:
                    corps = convertir(brut)
                    visuel = ('<div class="capture-zone">'
                              '<span>Coller ici la capture n° %s</span></div>' % numero)
                    bas = ''

                sortie.append(
                    '<figure class="capture">'
                    '<div class="capture-titre">'
                    '<span class="capture-num">FIGURE %s</span>'
                    '<span class="capture-sujet">%s</span>'
                    '</div>'
                    '<div class="capture-corps">%s</div>'
                    '%s%s'
                    '</figure>' % (numero, html.escape(sujet), corps, visuel, bas)
                )
                continue

            # Citation ordinaire : on convertit le contenu récursivement afin
            # de conserver listes, tableaux et blocs de code.
            sortie.append('<blockquote>%s</blockquote>' % convertir(interne))
            continue

        # Liste à puces ou numérotée
        m = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', ligne)
        if m:
            ordonnee = not m.group(2) in ('-', '*')
            balise = 'ol' if ordonnee else 'ul'
            elements = []
            while i < n:
                m2 = re.match(r'^(\s*)([-*]|\d+\.)\s+(.*)$', lignes[i])
                if not m2:
                    # Continuation indentée de l'élément courant.
                    if elements and lignes[i].startswith('  ') and lignes[i].strip():
                        elements[-1] += ' ' + lignes[i].strip()
                        i += 1
                        continue
                    break
                elements.append(m2.group(3))
                i += 1
            sortie.append('<%s>%s</%s>' % (
                balise,
                ''.join('<li>%s</li>' % en_ligne(e) for e in elements),
                balise,
            ))
            continue

        # Ligne vide
        if not ligne.strip():
            i += 1
            continue

        # Paragraphe
        bloc = []
        while i < n and lignes[i].strip() and not re.match(
                r'^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s|\|)', lignes[i]) \
                and not re.fullmatch(r'-{3,}', lignes[i].strip()):
            bloc.append(lignes[i].strip())
            i += 1
        if bloc:
            sortie.append('<p>%s</p>' % en_ligne(' '.join(bloc)))
        else:
            i += 1

    return '\n'.join(sortie)


def main():
    if not os.path.exists(SOURCE):
        sys.exit('Source introuvable : %s' % SOURCE)

    with open(SOURCE, encoding='utf-8') as f:
        md = f.read()

    corps = convertir(md)
    page = (
        '<!doctype html>\n<html lang="fr">\n<head>\n'
        '<meta charset="utf-8" />\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1" />\n'
        '<title>Smart-Shop — Compte-rendu</title>\n'
        '<style>%s</style>\n</head>\n<body>\n%s\n</body>\n</html>\n'
        % (CSS, corps)
    )

    with open(CIBLE, 'w', encoding='utf-8') as f:
        f.write(page)

    print('HTML généré : %s' % CIBLE)
    print()
    print('Pour obtenir le PDF :')
    print('  1. open "%s"' % CIBLE)
    print('  2. Cmd+P → Destination « Enregistrer au format PDF »')
    print('  3. Décocher en-têtes et pieds de page, marges « Par défaut »')


if __name__ == '__main__':
    main()
