const j = $input.first().json || {};
const schema = {
  "type": "object",
  "additionalProperties": false,
  "properties": {
    "transcript": {
      "type": "string"
    },
    "intent": {
      "type": "string",
      "enum": [
        "buscar_empleado",
        "crear_prestamo",
        "abrir_asistencia",
        "abrir_prestamos",
        "desconocida",
        "registrar_gasto_caja_chica",
        "crear_nota",
        "registrar_abono"
      ]
    },
    "employee": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "spokenName": {
          "type": [
            "string",
            "null"
          ]
        },
        "spokenNumber": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "spokenName",
        "spokenNumber"
      ]
    },
    "pettyCash": {
      "type": [
        "object",
        "null"
      ],
      "additionalProperties": false,
      "properties": {
        "amount": {
          "type": [
            "number",
            "null"
          ]
        },
        "concept": {
          "type": [
            "string",
            "null"
          ]
        },
        "date": {
          "type": [
            "string",
            "null"
          ]
        },
        "note": {
          "type": [
            "string",
            "null"
          ]
        },
        "spokenCategory": {
          "type": [
            "string",
            "null"
          ]
        },
        "paidTo": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "amount",
        "concept",
        "date",
        "note",
        "spokenCategory",
        "paidTo"
      ]
    },
    "extracted": {
      "type": [
        "object",
        "null"
      ],
      "additionalProperties": false,
      "properties": {
        "amount": {
          "type": [
            "number",
            "null"
          ]
        },
        "spokenName": {
          "type": [
            "string",
            "null"
          ]
        },
        "spokenNumber": {
          "type": [
            "string",
            "null"
          ]
        },
        "concept": {
          "type": [
            "string",
            "null"
          ]
        },
        "note": {
          "type": [
            "string",
            "null"
          ]
        },
        "date": {
          "type": [
            "string",
            "null"
          ]
        },
        "paidTo": {
          "type": [
            "string",
            "null"
          ]
        },
        "spokenCategory": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "amount",
        "spokenName",
        "spokenNumber",
        "concept",
        "note",
        "date",
        "paidTo",
        "spokenCategory"
      ]
    },
    "loan": {
      "type": [
        "object",
        "null"
      ],
      "additionalProperties": false,
      "properties": {
        "principal": {
          "type": [
            "number",
            "null"
          ]
        },
        "interestRate": {
          "type": [
            "number",
            "null"
          ]
        },
        "interestIncluded": {
          "type": [
            "boolean",
            "null"
          ]
        },
        "installmentMode": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "lump",
            "installments",
            null
          ]
        },
        "installmentCount": {
          "type": [
            "number",
            "null"
          ]
        },
        "installmentFrequencyWeeks": {
          "type": [
            "number",
            "null"
          ]
        },
        "startDate": {
          "type": [
            "string",
            "null"
          ]
        },
        "concept": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "principal",
        "interestRate",
        "interestIncluded",
        "installmentMode",
        "installmentCount",
        "installmentFrequencyWeeks",
        "startDate",
        "concept"
      ]
    },
    "needsReview": {
      "type": "boolean"
    },
    "issues": {
      "type": "array",
      "items": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "code": {
            "type": "string"
          },
          "field": {
            "type": [
              "string",
              "null"
            ]
          },
          "message": {
            "type": "string"
          }
        },
        "required": [
          "code",
          "field",
          "message"
        ]
      }
    },
    "evidence": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "employee": {
          "type": [
            "string",
            "null"
          ]
        },
        "principal": {
          "type": [
            "string",
            "null"
          ]
        },
        "interestRate": {
          "type": [
            "string",
            "null"
          ]
        },
        "installmentCount": {
          "type": [
            "string",
            "null"
          ]
        },
        "installmentFrequencyWeeks": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "employee",
        "principal",
        "interestRate",
        "installmentCount",
        "installmentFrequencyWeeks"
      ]
    },
    "note": {
      "type": [
        "object",
        "null"
      ],
      "additionalProperties": false,
      "properties": {
        "text": {
          "type": [
            "string",
            "null"
          ]
        },
        "date": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "text",
        "date"
      ]
    },
    "payment": {
      "type": [
        "object",
        "null"
      ],
      "additionalProperties": false,
      "properties": {
        "amount": {
          "type": [
            "number",
            "null"
          ]
        },
        "date": {
          "type": [
            "string",
            "null"
          ]
        },
        "note": {
          "type": [
            "string",
            "null"
          ]
        },
        "spokenLoanNumber": {
          "type": [
            "string",
            "null"
          ]
        },
        "channel": {
          "type": [
            "string",
            "null"
          ],
          "enum": [
            "payroll",
            "cash",
            "transfer",
            null
          ]
        },
        "payrollDate": {
          "type": [
            "string",
            "null"
          ]
        }
      },
      "required": [
        "amount",
        "date",
        "note",
        "spokenLoanNumber",
        "channel",
        "payrollDate"
      ]
    }
  },
  "required": [
    "transcript",
    "intent",
    "employee",
    "loan",
    "pettyCash",
    "extracted",
    "needsReview",
    "issues",
    "evidence",
    "note",
    "payment"
  ]
};
const geminiBody = {systemInstruction:{parts:[{text:$input.first().json.GeminiPromp}]},contents:[{role:'user',parts:[{text:'Analiza el audio y devuelve únicamente el JSON del esquema solicitado. Contexto operativo (solo para interpretar fechas/horas): ' + JSON.stringify(j.context || {})},{inlineData:{mimeType:j.mimeType,data:j.fileBase64}}]}],generationConfig:{temperature:0.1,maxOutputTokens:2048,responseMimeType:'application/json',responseJsonSchema:schema}};
return [{json:{requestId:j.requestId,uid:j.uid,geminiBody}}];
