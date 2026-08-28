# Política de Privacidade — Bia

_Última atualização: agosto de 2026_

A Bia é uma extensão de navegador que atua como agente de IA: conversa com você,
automatiza ações nas páginas a seu pedido e executa testes de QA com evidências.

## Quais dados a extensão trata

- **API key e configurações** (gateway, integrações Jira/Zephyr, preferências):
  ficam armazenadas **localmente** no seu navegador (`chrome.storage`). Não são
  enviadas a nenhum servidor da Bia — a extensão não possui backend próprio.
- **Conteúdo das páginas**: quando você pede uma ação ou teste, a estrutura da
  página ativa (elementos interativos e texto visível) é enviada ao **provedor de
  IA que VOCÊ configurou** (API da Anthropic ou gateway compatível de sua escolha),
  exclusivamente para executar o seu pedido. Valores sensíveis detectados
  (cookies, tokens, cabeçalhos de autenticação) são mascarados antes do envio e
  só são revelados mediante sua aprovação explícita.
- **Login Google (quando habilitado na build distribuída)**: usado apenas para
  verificar o domínio da sua conta e liberar o uso. Guardamos localmente e-mail e
  expiração da sessão. Nenhum dado de login é enviado a terceiros.
- **Evidências de teste** (vídeos e capturas): geradas e salvas **na sua máquina**
  (pasta de Downloads), sob seu controle.

## O que a extensão NÃO faz

- Não vende nem compartilha dados com terceiros.
- Não coleta analytics, telemetria ou histórico de navegação.
- Não transfere dados a nenhum servidor além do provedor de IA e das integrações
  (Jira/Zephyr) que você mesmo configurar com suas credenciais.

## Permissões e justificativas

| Permissão | Uso |
|---|---|
| `debugger`, `scripting`, `<all_urls>` | Executar as ações e testes que você pedir na aba ativa |
| `tabs`, `tabGroups`, `sidePanel`, `activeTab` | Operar o painel lateral e as abas de execução |
| `cookies` | Inspeção de sessão em depuração de QA, com mascaramento por padrão |
| `downloads` | Salvar evidências (vídeos/prints) na sua máquina |
| `storage` | Guardar configurações localmente |

## Contato

Projeto aberto e não-oficial, sem vínculo com nenhuma empresa.
Dúvidas e solicitações: abra uma issue em
https://github.com/lucashr-git/BIA-Extensions/issues
